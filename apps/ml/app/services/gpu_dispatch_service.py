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
    Release reserved wallet funds, charging for actual GPU runtime when a pod
    was launched.

    - Pod was never launched (dispatch failed) → charge $0, return full reservation.
    - Pod ran but job failed (e.g. S3 upload error, poll timeout) → charge for
      actual wall-clock time from started_at → finished_at at gpu_price_per_hour.
      RunPod bills from pod creation regardless of training outcome, so we do too.

    Safe to call multiple times — no-ops if nothing is reserved.
    """
    if not job.owner_email:
        return
    try:
        from app.services import wallet_service

        actual_cost = 0.0
        if job.remote_job_id and job.started_at and job.gpu_price_per_hour:
            # Pod was launched — charge for wall-clock GPU time
            finished = job.finished_at or utc_now()
            if finished.tzinfo is None:
                from datetime import timezone
                finished = finished.replace(tzinfo=timezone.utc)
            start = job.started_at
            if start.tzinfo is None:
                from datetime import timezone
                start = start.replace(tzinfo=timezone.utc)
            duration_hours = max(0.0, (finished - start).total_seconds() / 3600)
            actual_cost = round(job.gpu_price_per_hour * duration_hours, 4)
            logger.info(
                "wallet_gpu_charge_on_failure",
                job_id=str(job.id),
                duration_hours=round(duration_hours, 4),
                price_per_hour=job.gpu_price_per_hour,
                actual_cost=actual_cost,
            )

        wallet = await wallet_service.get_or_create(job.owner_email, job.org_id)
        if wallet.reserved > 0 or actual_cost > 0:
            await wallet_service.release_and_charge(wallet, str(job.id), actual_cost=actual_cost)
            logger.info(
                "wallet_reservation_released",
                job_id=str(job.id),
                owner=job.owner_email,
                actual_cost=actual_cost,
            )
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

        # Pre-fetch data source on the server side if no user-uploaded data was provided.
        # RunPod pods have no access to PMS infrastructure (MongoDB, Redis, MinIO), so
        # any DataSource that requires network connectivity must be loaded here and
        # serialised as pickle bytes for injection into the pod.
        if injected_data is None:
            from app.services.registry_service import get_trainer_class as _get_tc
            _trainer_cls = _get_tc(job.trainer_name)
            _ds = getattr(_trainer_cls, "data_source", None) if _trainer_cls else None
            if _ds is not None:
                # Skip sources that are already in-memory or expect file injection —
                # they either carry no data or will be handled by preprocess().
                from app.abstract.data_source import InMemoryDataSource, UploadedFileDataSource
                if not isinstance(_ds, (InMemoryDataSource, UploadedFileDataSource)):
                    try:
                        await job.set({
                            "log_lines": [
                                f"[cloud_gpu] Fetching data from {_ds.source_type} data source…"
                            ],
                            "updated_at": utc_now(),
                        })
                        _raw = await _ds.load()
                        injected_data = pickle.dumps(_raw)
                        logger.info(
                            "cloud_gpu_datasource_prefetched",
                            job_id=job_id,
                            source_type=_ds.source_type,
                            size_bytes=len(injected_data),
                        )
                    except Exception as _exc:
                        logger.warning(
                            "cloud_gpu_datasource_prefetch_failed",
                            job_id=job_id,
                            source_type=_ds.source_type,
                            error=str(_exc),
                        )
                        # Proceed without data — preprocess() may handle None or raise

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

    # ── Poll loop ──────────────────────────────────────────────────────────────
    # Every 5 s: fetch pod status (incl. GPU/CPU metrics from RunPod runtime).
    # Every 6 polls (~30 s): fetch pod logs, parse training metrics from stdout,
    # record a cost snapshot, and persist everything to the job document.
    max_polls     = 720   # max 1 h at 5 s interval
    log_every     = 6     # fetch logs every N polls
    status        = None
    seen_metrics: dict = {}         # training metrics parsed from pod stdout
    inline_model_bytes: Optional[bytes] = None  # model recovered from pod stdout (S3 fallback)

    def _accrued_usd(started_at, price_per_hour: float) -> float:
        if not started_at or not price_per_hour:
            return 0.0
        if started_at.tzinfo is None:
            from datetime import timezone
            started_at = started_at.replace(tzinfo=timezone.utc)
        elapsed_h = (utc_now() - started_at).total_seconds() / 3600
        return round(price_per_hour * max(0.0, elapsed_h), 6)

    for poll_n in range(max_polls):
        await asyncio.sleep(5)

        # ── Status (includes pod_metrics from RunPod runtime) ──────────────
        try:
            status = await provider.get_status(handle)
        except Exception:
            continue

        now = utc_now()
        update: dict = {"updated_at": now}

        # Persist pod-level telemetry (GPU util, CPU, memory, uptime)
        if status.pod_metrics:
            update["pod_metrics"] = status.pod_metrics

        # Cost snapshot every log_every polls
        if poll_n % log_every == 0:
            accrued = _accrued_usd(job.started_at, job.gpu_price_per_hour)
            snapshot = {
                "ts":         now.isoformat(),
                "elapsed_s":  round((now - job.started_at).total_seconds(), 1) if job.started_at else 0,
                "accrued_usd": accrued,
            }
            if status.pod_metrics.get("gpu_util_pct") is not None:
                snapshot["gpu_util_pct"] = status.pod_metrics["gpu_util_pct"]
            update["cost_log"] = (job.cost_log or []) + [snapshot]

            logger.info(
                "cloud_gpu_poll",
                job_id=job_id,
                pod_id=handle.remote_id,
                state=status.state,
                accrued_usd=accrued,
                pod_metrics=status.pod_metrics,
            )

        # ── Logs + training metrics ────────────────────────────────────────
        if poll_n % log_every == 0 and hasattr(provider, "fetch_logs"):
            try:
                pod_logs, train_metrics, model_bytes_from_log = await provider.fetch_logs(handle)
                if pod_logs:
                    update["log_lines"] = pod_logs[-100:]
                # If bootstrap already printed metrics, store them on the job
                # so they're visible even before S3 upload completes.
                if train_metrics and train_metrics != seen_metrics:
                    seen_metrics = train_metrics
                    update["metrics"] = {k: float(v) for k, v in train_metrics.items()
                                         if isinstance(v, (int, float))}
                    logger.info("cloud_gpu_metrics_from_logs", job_id=job_id, metrics=seen_metrics)
                # Capture inline model bytes from pod stdout (S3 fallback)
                if model_bytes_from_log and not inline_model_bytes:
                    inline_model_bytes = model_bytes_from_log
                    logger.info("cloud_gpu_inline_model_captured", job_id=job_id, size_bytes=len(inline_model_bytes))
            except Exception:
                pass
        elif status.log_lines:
            update["log_lines"] = status.log_lines[-50:]

        await job.set(update)

        if status.state in ("completed", "failed", "cancelled"):
            # Final log + metrics capture
            if hasattr(provider, "fetch_logs"):
                try:
                    final_logs, final_metrics, final_model_bytes = await provider.fetch_logs(handle)
                    final_update: dict = {"updated_at": utc_now()}
                    if final_logs:
                        final_update["log_lines"] = final_logs[-100:]
                    if final_metrics:
                        final_update["metrics"] = {k: float(v) for k, v in final_metrics.items()
                                                    if isinstance(v, (int, float))}
                        seen_metrics = final_metrics
                    if final_model_bytes and not inline_model_bytes:
                        inline_model_bytes = final_model_bytes
                        logger.info("cloud_gpu_inline_model_captured_final", job_id=job_id, size_bytes=len(inline_model_bytes))
                    await job.set(final_update)
                except Exception:
                    pass
            break

    if status is None or status.state != "completed":
        error_msg = (status.error if status else None) or (
            f"Remote job ended with state: {status.state}" if status else "No status received from provider"
        )
        finished_at = utc_now()
        fail_update: dict = {
            "status":      "failed",
            "error":       error_msg,
            "finished_at": finished_at,
            "updated_at":  finished_at,
        }
        if seen_metrics:
            fail_update["metrics"] = seen_metrics
        await job.set(fail_update)
        await _release_reserved(job)
        return

    # Attach any inline model bytes captured from pod stdout so get_result() can
    # use them as fallback when S3 is unreachable.
    if inline_model_bytes:
        handle._inline_model_bytes = inline_model_bytes

    # Fetch result (model.pkl + metrics.json from S3)
    try:
        result = await provider.get_result(handle)
    except Exception as exc:
        finished_at = utc_now()
        await job.set({
            "status":      "failed",
            "error":       f"Failed to fetch result: {exc}",
            "metrics":     seen_metrics or {},
            "finished_at": finished_at,
            "updated_at":  finished_at,
        })
        await _release_reserved(job)
        return

    # Merge metrics: S3 metrics.json takes precedence; fill gaps from log-parsed metrics
    merged_metrics = {**seen_metrics, **(result.metrics or {})}

    # Store model in MLflow
    try:
        model_uri = await _register_result(job, result)
    except Exception as exc:
        logger.warning("cloud_gpu_mlflow_failed", job_id=job_id, error=str(exc))
        model_uri = None

    finished_at = utc_now()

    # Final cost snapshot
    final_cost_snapshot = {
        "ts":          finished_at.isoformat(),
        "elapsed_s":   round((finished_at - job.started_at).total_seconds(), 1) if job.started_at else 0,
        "accrued_usd": round(
            job.gpu_price_per_hour * max(0.0, (finished_at - job.started_at).total_seconds() / 3600), 6
        ) if (job.gpu_price_per_hour and job.started_at) else 0,
        "final": True,
    }

    await job.set({
        "status":      "completed",
        "metrics":     merged_metrics,
        "model_uri":   model_uri,
        "log_lines":   (result.log_lines or [])[-50:],
        "finished_at": finished_at,
        "updated_at":  finished_at,
        "cost_log":    (job.cost_log or []) + [final_cost_snapshot],
    })
    logger.info(
        "cloud_gpu_training_completed",
        job_id=job_id,
        provider=provider_name,
        metrics=merged_metrics,
        elapsed_s=final_cost_snapshot["elapsed_s"],
        accrued_usd=final_cost_snapshot["accrued_usd"],
    )

    # Charge actual GPU cost to wallet
    if job.owner_email:
        from app.services import wallet_service

        # Use price stored at reservation time — avoids dependency on live GPU catalog
        # lookup in a fresh worker process where _STATIC_BY_ID may not be populated.
        price_per_hour = job.gpu_price_per_hour
        if price_per_hour is None and job.gpu_type_id:
            # Fallback: try live catalog lookup (populates _STATIC_BY_ID as side-effect)
            from app.services.gpu_providers.gpu_catalog import get_gpu_option_live
            from app.core.config import settings as _s
            _opt = await get_gpu_option_live(job.gpu_type_id, api_key=_s.RUNPOD_API_KEY or None)
            price_per_hour = _opt["price_per_hour"] if _opt else None

        if price_per_hour is not None and job.started_at:
            duration_hours = (finished_at - job.started_at).total_seconds() / 3600
            actual_cost = round(price_per_hour * duration_hours, 4)
            try:
                wallet = await wallet_service.get_or_create(job.owner_email, job.org_id)
                charged = await wallet_service.release_and_charge(wallet, str(job.id), actual_cost)
                await job.set({"wallet_charged": charged, "updated_at": utc_now()})
                logger.info(
                    "wallet_gpu_charged",
                    job_id=job_id,
                    duration_hours=round(duration_hours, 4),
                    price_per_hour=price_per_hour,
                    actual_cost=actual_cost,
                    charged=charged,
                )
            except Exception as exc:
                logger.warning("wallet_charge_failed", job_id=job_id, error=str(exc))
        elif job.wallet_reserved > 0:
            # No price info available — release reservation without charging
            try:
                from app.services import wallet_service as _ws
                wallet = await _ws.get_or_create(job.owner_email, job.org_id)
                await _ws.release_and_charge(wallet, str(job.id), actual_cost=0.0)
                logger.warning("wallet_charge_skipped_no_price", job_id=job_id)
            except Exception as exc:
                logger.warning("wallet_release_failed", job_id=job_id, error=str(exc))

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
