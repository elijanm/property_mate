"""Training job endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.dependencies.auth import require_roles, get_current_user
from app.models.training_job import TrainingJob
from app.models.trainer_registration import TrainerRegistration
from app.services.registry_service import get_trainer_class
from app.services import wallet_service
from app.services import ml_billing_service
from app.services.gpu_providers.gpu_catalog import get_gpu_option
from app.tasks.train_task import enqueue_training, enqueue_pretrained_deploy
from app.utils.datetime import utc_now

router = APIRouter(prefix="/training", tags=["training"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


def _job_dict(job: TrainingJob) -> dict:
    """Serialize a TrainingJob to a JSON-safe dict with id as string."""
    d = job.model_dump()
    d["id"] = str(job.id)
    return d


class StartTrainingRequest(BaseModel):
    trainer_name: str
    config_overrides: Optional[dict] = None
    compute_type: str = "local"          # local | cloud_gpu
    gpu_type_id: Optional[str] = None    # e.g. "NVIDIA GeForce RTX 3090"


def _detect_local_gpu() -> dict:
    """Return local GPU hardware info using PyTorch if available."""
    try:
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return {
                "gpu_name": props.name,
                "vram_gb": round(props.total_memory / (1024 ** 3), 1),
                "compute_capability": f"{props.major}.{props.minor}",
                "is_cuda_available": True,
                "gpu_count": torch.cuda.device_count(),
            }
    except Exception:
        pass
    return {
        "gpu_name": "CPU only",
        "vram_gb": 0,
        "compute_capability": None,
        "is_cuda_available": False,
        "gpu_count": 0,
    }


@router.get("/local-info")
async def get_local_training_info(user=Depends(get_current_user)):
    """Return local compute availability + billing info for the current user."""
    gpu_info = _detect_local_gpu()

    is_free, free_secs, price_per_hour = await ml_billing_service.check_local_training(
        user.email, user.org_id
    )
    cfg = await ml_billing_service.get_pricing_config()
    user_plan = await ml_billing_service.get_user_plan(user.email, user.org_id)
    is_exempt = bool(user_plan and getattr(user_plan, "local_gpu_exempt", False))

    return {
        **gpu_info,
        "is_free": is_free,
        "is_exempt": is_exempt,
        "global_free": cfg.local_gpu_free,
        "price_per_hour": price_per_hour,
        "free_secs_remaining": free_secs if free_secs != float("inf") else None,
    }


@router.get("/gpu-options")
async def list_gpu_options(user=Depends(get_current_user)):
    """Return live GPU options with marked-up pricing (cached 5 min). Falls back to static list."""
    from app.core.config import settings
    from app.services.gpu_providers.gpu_catalog import get_gpu_options

    available = bool(
        settings.RUNPOD_API_KEY
        or settings.LAMBDA_LABS_API_KEY
        or (settings.MODAL_TOKEN_ID and settings.MODAL_TOKEN_SECRET)
    )
    if not available:
        return {"options": [], "available": False, "source": "none"}

    options = await get_gpu_options(api_key=settings.RUNPOD_API_KEY or None)
    source = "live" if settings.RUNPOD_API_KEY else "static"
    return {"options": options, "available": True, "source": source}


@router.post("/start")
async def start_training(
    body: StartTrainingRequest,
    user=Depends(require_roles("engineer", "admin")),
):
    """Trigger a training run (no file upload)."""
    if not get_trainer_class(body.trainer_name):
        raise HTTPException(status_code=404, detail=f"Trainer '{body.trainer_name}' not registered")

    # Wallet reservation for cloud GPU jobs; quota check for local jobs
    wallet = None
    reservation = 0.0
    if body.compute_type == "cloud_gpu":
        gpu = get_gpu_option(body.gpu_type_id or "")
        if not gpu:
            raise HTTPException(status_code=400, detail="Invalid gpu_type_id — select a valid GPU option")

        # Resolve estimated duration from trainer class, then DB record
        trainer_cls = get_trainer_class(body.trainer_name)
        est_mins = getattr(trainer_cls, "estimated_duration_minutes", 60) if trainer_cls else 60
        trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == body.trainer_name)
        if trainer_reg and trainer_reg.estimated_duration_minutes:
            est_mins = trainer_reg.estimated_duration_minutes

        est_cost = round(gpu["price_per_hour"] * (est_mins / 60), 4)
        reservation = round(est_cost * 3.0, 2)

        wallet = await wallet_service.get_or_create(user.email, user.org_id)
        if wallet_service.available(wallet) < reservation:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient wallet balance. Need ${reservation:.2f} USD, "
                    f"available ${wallet_service.available(wallet):.2f} USD. "
                    "Top up your wallet."
                ),
            )
    elif body.compute_type == "local":
        is_free, free_secs, local_price = await ml_billing_service.check_local_training(
            user.email, user.org_id
        )
        if not is_free:
            # Need to reserve wallet for this local job
            trainer_cls = get_trainer_class(body.trainer_name)
            est_mins = getattr(trainer_cls, "estimated_duration_minutes", 60) if trainer_cls else 60
            trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == body.trainer_name)
            if trainer_reg and trainer_reg.estimated_duration_minutes:
                est_mins = trainer_reg.estimated_duration_minutes
            est_cost = round(local_price * (est_mins / 60), 4)
            reservation = round(est_cost * 1.5, 2)   # 1.5x buffer for local (more predictable than cloud)

            wallet = await wallet_service.get_or_create(user.email, user.org_id)
            if wallet_service.available(wallet) < reservation:
                raise HTTPException(
                    status_code=402,
                    detail=(
                        f"No free training hours remaining on your plan. "
                        f"Local training costs ${local_price:.2f}/hr. "
                        f"Need ${reservation:.2f} USD reserved, "
                        f"available ${wallet_service.available(wallet):.2f} USD. "
                        "Top up your wallet."
                    ),
                )

    job_id = await enqueue_training(
        trainer_name=body.trainer_name,
        trigger="manual",
        training_config_extra=body.config_overrides,
        owner_email=user.email,
        org_id=user.org_id,
        compute_type=body.compute_type,
        gpu_type_id=body.gpu_type_id,
    )

    # Reserve wallet funds after job is created (cloud GPU and paid local)
    if wallet is not None and reservation > 0:
        if body.compute_type == "cloud_gpu":
            gpu = get_gpu_option(body.gpu_type_id or "")
            gpu_name = gpu["name"] if gpu else body.gpu_type_id or "GPU"
            price_per_hour = gpu["price_per_hour"] if gpu else None
            desc = f"GPU training reservation — {body.trainer_name} on {gpu_name}"
        else:
            price_per_hour = local_price
            desc = f"Local training reservation — {body.trainer_name} · ${local_price:.2f}/hr"
        await wallet_service.reserve(wallet, reservation, job_id, desc)
        job = await TrainingJob.get(job_id)
        if job:
            await job.set({
                "wallet_reserved": reservation,
                "gpu_price_per_hour": price_per_hour,
                "updated_at": utc_now(),
            })

    return {"job_id": job_id, "status": "queued"}


@router.post("/start-with-data")
async def start_training_with_file(
    trainer_name: str = Form(...),
    file: UploadFile = File(...),
    compute_type: str = Form("local"),
    gpu_type_id: Optional[str] = Form(None),
    user=Depends(require_roles("engineer", "admin")),
):
    """Trigger training and upload training data file in one request."""
    if not get_trainer_class(trainer_name):
        raise HTTPException(status_code=404, detail=f"Trainer '{trainer_name}' not registered")

    # Wallet reservation for cloud GPU jobs; quota check for local jobs
    wallet = None
    reservation = 0.0
    if compute_type == "cloud_gpu":
        gpu = get_gpu_option(gpu_type_id or "")
        if not gpu:
            raise HTTPException(status_code=400, detail="Invalid gpu_type_id — select a valid GPU option")

        trainer_cls = get_trainer_class(trainer_name)
        est_mins = getattr(trainer_cls, "estimated_duration_minutes", 60) if trainer_cls else 60
        trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
        if trainer_reg and trainer_reg.estimated_duration_minutes:
            est_mins = trainer_reg.estimated_duration_minutes

        est_cost = round(gpu["price_per_hour"] * (est_mins / 60), 4)
        reservation = round(est_cost * 3.0, 2)

        wallet = await wallet_service.get_or_create(user.email, user.org_id)
        if wallet_service.available(wallet) < reservation:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient wallet balance. Need ${reservation:.2f} USD, "
                    f"available ${wallet_service.available(wallet):.2f} USD. "
                    "Top up your wallet."
                ),
            )
    elif compute_type == "local":
        is_free, free_secs, local_price = await ml_billing_service.check_local_training(
            user.email, user.org_id
        )
        if not is_free:
            trainer_cls = get_trainer_class(trainer_name)
            est_mins = getattr(trainer_cls, "estimated_duration_minutes", 60) if trainer_cls else 60
            trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
            if trainer_reg and trainer_reg.estimated_duration_minutes:
                est_mins = trainer_reg.estimated_duration_minutes
            est_cost = round(local_price * (est_mins / 60), 4)
            reservation = round(est_cost * 1.5, 2)

            wallet = await wallet_service.get_or_create(user.email, user.org_id)
            if wallet_service.available(wallet) < reservation:
                raise HTTPException(
                    status_code=402,
                    detail=(
                        f"No free training hours remaining on your plan. "
                        f"Local training costs ${local_price:.2f}/hr. "
                        f"Need ${reservation:.2f} USD reserved, "
                        f"available ${wallet_service.available(wallet):.2f} USD. "
                        "Top up your wallet."
                    ),
                )

    data = await file.read()
    job_id = await enqueue_training(
        trainer_name=trainer_name,
        trigger="manual",
        injected_data=data,
        owner_email=user.email,
        org_id=user.org_id,
        compute_type=compute_type,
        gpu_type_id=gpu_type_id,
    )

    if wallet is not None and reservation > 0:
        if compute_type == "cloud_gpu":
            gpu = get_gpu_option(gpu_type_id or "")
            gpu_name = gpu["name"] if gpu else gpu_type_id or "GPU"
            price_per_hour = gpu["price_per_hour"] if gpu else None
            desc = f"GPU training reservation — {trainer_name} on {gpu_name}"
        else:
            price_per_hour = local_price
            desc = f"Local training reservation — {trainer_name} · ${local_price:.2f}/hr"
        await wallet_service.reserve(wallet, reservation, job_id, desc)
        job = await TrainingJob.get(job_id)
        if job:
            await job.set({
                "wallet_reserved": reservation,
                "gpu_price_per_hour": price_per_hour,
                "updated_at": utc_now(),
            })

    return {"job_id": job_id, "status": "queued", "data_size_bytes": len(data)}


@router.get("/jobs")
async def list_jobs(
    trainer_name: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    user=Depends(get_current_user),
):
    # Always scope to caller's org
    filters = [TrainingJob.org_id == user.org_id]
    if trainer_name:
        filters.append(TrainingJob.trainer_name == trainer_name)
    if status:
        filters.append(TrainingJob.status == status)
    skip = (page - 1) * page_size

    if user.role != "admin":
        # Non-admin: only see their own jobs within the org
        filters.append(TrainingJob.owner_email == user.email)

    query = TrainingJob.find(*filters).sort(-TrainingJob.created_at)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).to_list()

    return {"items": [_job_dict(j) for j in items], "total": total, "page": page, "page_size": page_size}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user=Depends(get_current_user)):
    try:
        job = await TrainingJob.get(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.org_id and job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if user.role != "admin" and job.owner_email != user.email:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_dict(job)


@router.post("/jobs/{job_id}/rerun")
async def rerun_job(job_id: str, user=Depends(require_roles("engineer", "admin"))):
    """
    Re-queue a job using the same parameters as the original run.
    Works for both training jobs (trigger != 'import') and pretrained imports.
    Only terminal jobs (completed, failed, cancelled) can be rerun.
    """
    try:
        job = await TrainingJob.get(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.org_id and job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if user.role != "admin" and job.owner_email != user.email:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Cannot rerun job in status '{job.status}' — only completed/failed/cancelled jobs can be rerun")

    if job.trigger == "import":
        deploy_kwargs = {
            "name": job.trainer_name,
            "version": job.trainer_version,
        }
        deploy_kwargs.update(job.training_config.get("extra") or {})
        new_job_id = await enqueue_pretrained_deploy(deploy_kwargs, owner_email=user.email, org_id=user.org_id)
    else:
        new_job_id = await enqueue_training(
            trainer_name=job.trainer_name,
            trigger="manual",
            training_config_extra=job.training_config.get("extra"),
            owner_email=user.email,
            org_id=user.org_id,
        )

    return {"job_id": new_job_id, "status": "queued", "rerun_of": job_id}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user=Depends(require_roles("engineer", "admin"))):
    """Permanently delete a single job record."""
    try:
        job = await TrainingJob.get(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.org_id and job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if user.role != "admin" and job.owner_email != user.email:
        raise HTTPException(status_code=404, detail="Job not found")
    # Release reserved funds before deleting (record would be gone otherwise)
    if job.owner_email and job.status in ("queued", "running"):
        w = await wallet_service.get_or_create(job.owner_email, job.org_id)
        if w.reserved > 0:
            await wallet_service.release_and_charge(w, str(job.id), actual_cost=0.0)
    await job.delete()
    return {"deleted": True}


@router.delete("/jobs")
async def delete_all_jobs(
    trainer_name: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(require_roles("engineer", "admin")),
):
    """Delete job records within caller's org (optionally filtered by trainer_name/status).
    Non-admin users only delete their own jobs."""
    filters = [TrainingJob.org_id == user.org_id]
    if trainer_name:
        filters.append(TrainingJob.trainer_name == trainer_name)
    if status:
        filters.append(TrainingJob.status == status)
    if user.role != "admin":
        filters.append(TrainingJob.owner_email == user.email)

    jobs = await TrainingJob.find(*filters).to_list()
    # Release reserved funds for any active jobs before deleting
    for j in jobs:
        if j.owner_email and j.status in ("queued", "running"):
            try:
                w = await wallet_service.get_or_create(j.owner_email, j.org_id)
                if w.reserved > 0:
                    await wallet_service.release_and_charge(w, str(j.id), actual_cost=0.0)
            except Exception:
                pass
    result = await TrainingJob.find(*filters).delete()
    return {"deleted": result.deleted_count if result else 0}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, user=Depends(require_roles("engineer", "admin"))):
    try:
        job = await TrainingJob.get(job_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.org_id and job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if user.role != "admin" and job.owner_email != user.email:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job in status '{job.status}'")

    # Revoke Celery task if it has one
    if job.celery_task_id:
        try:
            from app.core.celery_app import celery_app
            celery_app.control.revoke(job.celery_task_id, terminate=True)
        except Exception:
            pass

    # Terminate cloud pod if already dispatched
    if job.remote_job_id and job.gpu_provider:
        try:
            from app.services.gpu_dispatch_service import _get_provider
            provider = _get_provider(job.gpu_provider or "runpod")
            handle = type("H", (), {"remote_id": job.remote_job_id, "extra": {}})()
            await provider.cancel(handle)
        except Exception:
            pass

    await job.set({"status": "cancelled", "finished_at": utc_now(), "updated_at": utc_now()})

    # Release any reserved wallet funds
    if job.owner_email:
        w = await wallet_service.get_or_create(job.owner_email, job.org_id)
        if w.reserved > 0:
            await wallet_service.release_and_charge(w, str(job.id), actual_cost=0.0)
    return {"cancelled": True}
