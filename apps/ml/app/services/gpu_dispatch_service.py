"""GPU dispatch service — serialises trainer, sends to cloud provider, polls, stores result."""
import asyncio
import os
import pickle
import tempfile
from pathlib import Path
from typing import Optional

import structlog

from app.core.config import settings
from app.models.training_job import TrainingJob
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _get_provider(name: str):
    """Return initialised provider based on name and settings."""
    if name == "runpod":
        from app.services.gpu_providers.runpod import RunPodProvider
        if not settings.RUNPOD_API_KEY:
            raise ValueError("RUNPOD_API_KEY must be configured")
        return RunPodProvider(
            api_key=settings.RUNPOD_API_KEY,
            container_disk_gb=settings.RUNPOD_CONTAINER_DISK_GB,
        )
    elif name == "lambda_labs":
        from app.services.gpu_providers.lambda_labs import LambdaLabsProvider
        if not settings.LAMBDA_LABS_API_KEY:
            raise ValueError("LAMBDA_LABS_API_KEY must be configured")
        return LambdaLabsProvider(
            api_key=settings.LAMBDA_LABS_API_KEY,
            ssh_key_name=settings.LAMBDA_LABS_SSH_KEY_NAME,
            instance_type=settings.LAMBDA_LABS_INSTANCE_TYPE,
        )
    elif name == "modal":
        from app.services.gpu_providers.modal_provider import ModalProvider
        if not settings.MODAL_TOKEN_ID or not settings.MODAL_TOKEN_SECRET:
            raise ValueError("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET must be configured")
        return ModalProvider(
            token_id=settings.MODAL_TOKEN_ID,
            token_secret=settings.MODAL_TOKEN_SECRET,
            app_id=settings.MODAL_APP_ID,
        )
    else:
        raise ValueError(f"Unknown GPU provider: {name!r}")


def _get_trainer_source(trainer_name: str) -> str:
    """Return the full Python source of the trainer plugin file."""
    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    for f in plugin_dir.glob("*.py"):
        source = f.read_text()
        # Quick check: does the file define a class with name == trainer_name
        if f'name = "{trainer_name}"' in source or f"name = '{trainer_name}'" in source:
            return source
    raise FileNotFoundError(f"Trainer source file not found for {trainer_name!r}")


async def _release_reserved(job: TrainingJob) -> None:
    """
    Release any reserved wallet funds for a failed/cancelled job (charge $0).
    Safe to call multiple times — no-ops if nothing is reserved.
    """
    if not job.owner_email:
        return
    try:
        from app.services import wallet_service
        wallet = await wallet_service.get_or_create(job.owner_email, job.org_id)
        if wallet.reserved > 0:
            await wallet_service.release_and_charge(wallet, str(job.id), actual_cost=0.0)
            logger.info("wallet_reservation_released", job_id=str(job.id), owner=job.owner_email)
    except Exception as exc:
        logger.warning("wallet_release_failed", job_id=str(job.id), error=str(exc))


async def resume_interrupted_gpu_jobs() -> None:
    """
    Called once at service startup. Finds all cloud GPU jobs that were left in
    'queued' or 'running' state (service was restarted mid-execution) and:
      - running + remote_job_id set  → re-enqueue polling so they complete normally
      - queued / running without remote_job_id → mark failed + release reservation
    """
    try:
        stuck = await TrainingJob.find(
            {"compute_type": "cloud_gpu", "status": {"$in": ["queued", "running"]}},
        ).to_list()
        if not stuck:
            return
        logger.info("cloud_gpu_resuming_interrupted_jobs", count=len(stuck))
        for job in stuck:
            if job.remote_job_id:
                # Re-enqueue polling via Celery so it runs in the worker
                try:
                    from app.tasks.train_task import train_model_task
                    train_model_task.apply_async(args=[str(job.id)], countdown=2)
                    logger.info("cloud_gpu_reenqueued", job_id=str(job.id), remote_id=job.remote_job_id)
                except Exception as exc:
                    logger.warning("cloud_gpu_reenqueue_failed", job_id=str(job.id), error=str(exc))
            else:
                # Never reached the provider — safe to fail immediately
                await job.set({
                    "status": "failed",
                    "error": "Job interrupted before dispatch (service restarted)",
                    "finished_at": utc_now(),
                    "updated_at": utc_now(),
                })
                await _release_reserved(job)
                logger.info("cloud_gpu_interrupted_released", job_id=str(job.id))
    except Exception as exc:
        logger.warning("cloud_gpu_resume_failed", error=str(exc))


async def run_cloud_training(job: TrainingJob, injected_data: Optional[bytes] = None) -> None:
    """
    Dispatch a training job to a cloud GPU provider.
    Updates job status throughout. Stores result in MLflow + ModelDeployment.
    """
    provider_name = job.gpu_provider or "runpod"
    job_id = str(job.id)

    try:
        provider = _get_provider(provider_name)
    except ValueError as exc:
        await job.set({"status": "failed", "error": str(exc), "finished_at": utc_now(), "updated_at": utc_now()})
        await _release_reserved(job)
        return

    # ── Resume path: job already dispatched (service was restarted mid-poll) ──
    if job.remote_job_id:
        logger.info("cloud_gpu_resuming_poll", job_id=job_id, remote_id=job.remote_job_id)
        result_prefix = (
            f"{job.org_id}/cloud_training/{job_id}" if job.org_id else f"cloud_training/{job_id}"
        )
        handle = type("H", (), {
            "provider": provider_name,
            "remote_id": job.remote_job_id,
            "extra": {"result_prefix": result_prefix},
        })()
        await job.set({
            "log_lines": [
                f"[cloud_gpu] Resuming poll for remote_id={job.remote_job_id} after service restart"
            ],
            "updated_at": utc_now(),
        })
        # Jump straight to the poll loop below
    else:
        # Get trainer source
        try:
            trainer_code = _get_trainer_source(job.trainer_name)
        except FileNotFoundError as exc:
            await job.set({"status": "failed", "error": str(exc), "finished_at": utc_now(), "updated_at": utc_now()})
            await _release_reserved(job)
            return

        await job.set({
            "status": "running",
            "started_at": utc_now(),
            "updated_at": utc_now(),
            "log_lines": [f"[cloud_gpu] Dispatching to {provider_name} · gpu={job.gpu_type_id or 'default'}…"],
        })

        try:
            handle = await provider.dispatch(
                trainer_name=job.trainer_name,
                trainer_code=trainer_code,
                config=job.training_config.get("extra") or {},
                injected_data=injected_data,
                org_id=job.org_id,
                job_id=job_id,
                gpu_type_id=job.gpu_type_id,
            )
        except Exception as exc:
            err_msg = str(exc)
            logger.error("cloud_gpu_dispatch_failed", job_id=job_id, provider=provider_name, error=err_msg)
            await job.set({
                "status": "failed",
                "error": f"Dispatch failed: {err_msg}",
                "log_lines": [f"[cloud_gpu] Dispatch failed: {err_msg}"],
                "finished_at": utc_now(),
                "updated_at": utc_now(),
            })
            await _release_reserved(job)
            return

        await job.set({
            "remote_job_id": handle.remote_id,
            "log_lines": [f"[cloud_gpu] Job dispatched to {provider_name} · remote_id={handle.remote_id}"],
            "updated_at": utc_now(),
        })

    # Poll until done
    max_polls = 720   # 1h at 5s interval
    status = None
    for _ in range(max_polls):
        await asyncio.sleep(5)
        try:
            status = await provider.get_status(handle)
        except Exception:
            continue

        if status.state in ("completed", "failed", "cancelled"):
            break
        if status.log_lines:
            await job.set({
                "log_lines": status.log_lines[-50:],
                "updated_at": utc_now(),
            })

    if status is None or status.state != "completed":
        error_msg = (status.error if status else None) or (
            f"Remote job ended with state: {status.state}" if status else "No status received from provider"
        )
        await job.set({
            "status": "failed",
            "error": error_msg,
            "finished_at": utc_now(),
            "updated_at": utc_now(),
        })
        await _release_reserved(job)
        return

    # Fetch result
    try:
        result = await provider.get_result(handle)
    except Exception as exc:
        await job.set({
            "status": "failed",
            "error": f"Failed to fetch result: {exc}",
            "finished_at": utc_now(),
            "updated_at": utc_now(),
        })
        await _release_reserved(job)
        return

    # Store model in MLflow
    try:
        model_uri = await _register_result(job, result)
    except Exception as exc:
        logger.warning("cloud_gpu_mlflow_failed", job_id=job_id, error=str(exc))
        model_uri = None

    finished_at = utc_now()
    await job.set({
        "status": "completed",
        "metrics": result.metrics,
        "model_uri": model_uri,
        "log_lines": (result.log_lines or [])[-50:],
        "finished_at": finished_at,
        "updated_at": finished_at,
    })
    logger.info("cloud_gpu_training_completed", job_id=job_id, provider=provider_name, metrics=result.metrics)

    # Charge actual GPU cost to wallet
    if job.gpu_type_id and job.owner_email:
        from app.services.gpu_providers.gpu_catalog import get_gpu_option
        from app.services import wallet_service

        gpu_opt = get_gpu_option(job.gpu_type_id)
        if gpu_opt and job.started_at:
            duration_hours = (finished_at - job.started_at).total_seconds() / 3600
            actual_cost = round(gpu_opt["price_per_hour"] * duration_hours, 4)
            try:
                wallet = await wallet_service.get_or_create(job.owner_email, job.org_id)
                charged = await wallet_service.release_and_charge(wallet, str(job.id), actual_cost)
                await job.set({"wallet_charged": charged, "updated_at": utc_now()})
            except Exception as exc:
                logger.warning("wallet_charge_failed", job_id=job_id, error=str(exc))

    # Resource overrun detection
    try:
        from app.models.trainer_registration import TrainerRegistration
        trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == job.trainer_name)
        if trainer_reg and job.started_at:
            actual_mins = (finished_at - job.started_at).total_seconds() / 60
            if actual_mins > trainer_reg.estimated_duration_minutes * 3:
                new_count = trainer_reg.overrun_count + 1
                update: dict = {"overrun_count": new_count, "updated_at": utc_now()}
                if new_count >= 3:
                    update["resource_intensive"] = True
                    logger.warning(
                        "trainer_marked_resource_intensive",
                        trainer=job.trainer_name,
                        overrun_count=new_count,
                    )
                await trainer_reg.set(update)
    except Exception as exc:
        logger.warning("overrun_detection_failed", job_id=job_id, error=str(exc))


async def _register_result(job: TrainingJob, result) -> Optional[str]:
    """Log returned model to MLflow and create a ModelDeployment record."""
    import mlflow

    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    experiment_name = f"{job.org_id or 'system'}_models"
    mlflow.set_experiment(experiment_name)

    with mlflow.start_run(run_name=f"{job.trainer_name}-cloud-{str(job.id)[:8]}") as run:
        mlflow.log_param("trainer_name", job.trainer_name)
        mlflow.log_param("gpu_provider", job.gpu_provider)
        mlflow.log_param("compute_type", "cloud_gpu")
        for k, v in (result.metrics or {}).items():
            try:
                mlflow.log_metric(k, float(v))
            except Exception:
                pass

        model_uri: Optional[str] = None
        if result.model_bytes:
            model = pickle.loads(result.model_bytes)
            try:
                import sklearn  # noqa: F401
                mlflow.sklearn.log_model(model, "model")
                model_uri = f"runs:/{run.info.run_id}/model"
            except Exception:
                with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False) as f:
                    f.write(result.model_bytes)
                    tmp_path = f.name
                try:
                    mlflow.log_artifact(tmp_path, "model")
                    model_uri = f"runs:/{run.info.run_id}/model"
                finally:
                    os.unlink(tmp_path)

    if not model_uri:
        return None

    # Register in MLflow model registry
    client = mlflow.tracking.MlflowClient()
    reg_name = f"{job.org_id}_{job.trainer_name}" if job.org_id else job.trainer_name
    try:
        client.create_registered_model(reg_name)
    except Exception:
        pass
    mv = client.create_model_version(name=reg_name, source=model_uri, run_id=run.info.run_id)
    final_uri = f"models:/{reg_name}/{mv.version}"

    # Create ModelDeployment
    from app.models.model_deployment import ModelDeployment
    from app.services.registry_service import get_trainer_class
    trainer_cls = get_trainer_class(job.trainer_name)
    dep = ModelDeployment(
        org_id=job.org_id,
        trainer_name=job.trainer_name,
        version=job.trainer_version,
        mlflow_model_name=reg_name,
        mlflow_model_version=str(mv.version),
        run_id=run.info.run_id,
        model_uri=final_uri,
        source_type="trained",
        is_default=True,
        metrics=result.metrics or {},
        input_schema=getattr(trainer_cls, "input_schema", {}) if trainer_cls else {},
        output_schema=getattr(trainer_cls, "output_schema", {}) if trainer_cls else {},
        category=getattr(trainer_cls, "category", {}) if trainer_cls else {},
        visibility="engineer",
        owner_email=job.owner_email,
    )
    # Demote previous defaults for this trainer within org
    await ModelDeployment.find(
        ModelDeployment.org_id == job.org_id,
        ModelDeployment.trainer_name == job.trainer_name,
        ModelDeployment.is_default == True,
    ).update({"$set": {"is_default": False}})
    await dep.insert()

    return final_uri
