"""Celery tasks: model training and pre-trained model import."""
import asyncio
import base64
from typing import Any, Dict, Optional

# A single persistent event loop reused across all Celery task invocations.
# asyncio.run() closes the loop after each call which breaks Motor's thread
# executor on subsequent tasks — so we manage the loop manually instead.
_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)


def _run_async(coro):
    """Run a coroutine on the persistent worker event loop."""
    return _loop.run_until_complete(coro)

import structlog

from app.core.celery_app import celery_app
from app.models.training_job import TrainingJob
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def enqueue_training(
    trainer_name: str,
    trigger: str = "manual",
    training_config_extra: Optional[dict] = None,
    injected_data: Optional[bytes] = None,
    owner_email: Optional[str] = None,
    org_id: str = "",
    compute_type: str = "local",
    gpu_type_id: Optional[str] = None,
    dataset_slug_override: Optional[str] = None,
) -> str:
    """Create a DB job record and dispatch Celery task. Returns job_id."""
    from app.services.registry_service import get_trainer_class
    trainer_cls = get_trainer_class(trainer_name)
    version = getattr(trainer_cls, "version", "1.0.0") if trainer_cls else "unknown"

    # Resolve provider from gpu_type_id (currently all GPUs route through RunPod)
    gpu_provider = "runpod" if gpu_type_id else None

    job = TrainingJob(
        org_id=org_id,
        trainer_name=trainer_name,
        trainer_version=version,
        trigger=trigger,
        training_config={"extra": training_config_extra or {}},
        owner_email=owner_email,
        compute_type=compute_type,
        gpu_provider=gpu_provider,
        gpu_type_id=gpu_type_id,
        dataset_slug_override=dataset_slug_override or None,
    )
    await job.insert()
    job_id = str(job.id)

    task = train_model_task.apply_async(
        args=[job_id],
        kwargs={"injected_data_b64": _b64(injected_data)},
    )
    await job.set({"celery_task_id": task.id, "updated_at": utc_now()})
    return job_id


def _b64(data: Optional[bytes]) -> Optional[str]:
    return base64.b64encode(data).decode() if data else None


# ── pre-trained import ─────────────────────────────────────────────────────────

async def enqueue_pretrained_deploy(
    deploy_kwargs: Dict[str, Any],
    file_bytes: Optional[bytes] = None,
    inference_script: Optional[bytes] = None,
    owner_email: Optional[str] = None,
    org_id: str = "",
) -> str:
    """Create a DB job record for a pretrained import and dispatch Celery task. Returns job_id."""
    job = TrainingJob(
        org_id=org_id,
        trainer_name=deploy_kwargs.get("name", "unknown"),
        trainer_version=deploy_kwargs.get("version", "1.0.0"),
        trigger="import",
        status="queued",
        training_config={"extra": {k: v for k, v in deploy_kwargs.items() if k not in ("name", "version", "file_bytes")}},
        owner_email=owner_email,
    )
    await job.insert()
    job_id = str(job.id)

    task = deploy_pretrained_task.apply_async(
        args=[job_id],
        kwargs={
            "deploy_kwargs": deploy_kwargs,
            "file_b64": _b64(file_bytes),
            "script_b64": _b64(inference_script),
        },
    )
    await job.set({"celery_task_id": task.id, "updated_at": utc_now()})
    return job_id


@celery_app.task(name="ml_studio.deploy_pretrained", bind=True, max_retries=0)
def deploy_pretrained_task(
    self,
    job_id: str,
    deploy_kwargs: Dict[str, Any],
    file_b64: Optional[str] = None,
    script_b64: Optional[str] = None,
) -> dict:
    # ZIP-based deploy passes persistent file paths; fallback to b64 bytes for direct uploads
    _model_path   = deploy_kwargs.pop("_model_path", None)
    _script_path  = deploy_kwargs.pop("_script_path", None)
    _zip_root     = deploy_kwargs.pop("_zip_root", None)

    if _model_path:
        with open(_model_path, "rb") as f:
            file_bytes = f.read()
    else:
        file_bytes = base64.b64decode(file_b64) if file_b64 else None

    if _script_path:
        with open(_script_path, "rb") as f:
            script_bytes = f.read()
    else:
        script_bytes = base64.b64decode(script_b64) if script_b64 else None

    async def _run():
        from app.core.database import init_db
        await init_db()

        job = await TrainingJob.get(job_id)
        await job.set({"status": "running", "started_at": utc_now(), "updated_at": utc_now()})
        try:
            from app.services.pretrained_deploy_service import deploy_pretrained
            dep = await deploy_pretrained(
                **deploy_kwargs,
                file_bytes=file_bytes,
                inference_script=script_bytes,
                zip_root=_zip_root,
                owner_email=job.owner_email,
                org_id=job.org_id,
            )
            await job.set({
                "status": "completed",
                "model_uri": dep.model_uri,
                "finished_at": utc_now(),
                "updated_at": utc_now(),
            })
        except Exception as exc:
            await job.set({
                "status": "failed",
                "error": str(exc),
                "finished_at": utc_now(),
                "updated_at": utc_now(),
            })
            raise

    _run_async(_run())
    return {"job_id": job_id}


@celery_app.task(name="ml_studio.train", bind=True, max_retries=0)
def train_model_task(self, job_id: str, injected_data_b64: Optional[str] = None) -> dict:
    import base64
    from app.core.database import init_db

    injected = base64.b64decode(injected_data_b64) if injected_data_b64 else None

    async def _run():
        await init_db()
        from app.services.registry_service import scan_and_register_plugins
        job = await TrainingJob.get(job_id)
        # Scan with the job owner's context so org namespace/alias are preserved
        await scan_and_register_plugins(
            owner_email=job.owner_email if job else None,
            org_id=job.org_id if job else None,
        )
        if job and job.compute_type == "cloud_gpu":
            from app.services.gpu_dispatch_service import run_cloud_training
            await run_cloud_training(job, injected_data=injected)
        else:
            from app.services.training_service import run_training
            await run_training(job_id, injected_data=injected)

    _run_async(_run())
    return {"job_id": job_id}
