"""Global training configuration endpoints."""
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies.auth import require_roles
from app.models.training_config import TrainingConfig as TrainingConfigDoc
from app.utils.datetime import utc_now

router = APIRouter(prefix="/config", tags=["config"])

_admin = Depends(require_roles("admin"))


class UpdateConfigRequest(BaseModel):
    cuda_device: Optional[str] = None
    workers: Optional[int] = None
    batch_size: Optional[int] = None
    fp16: Optional[bool] = None
    max_epochs: Optional[int] = None
    early_stopping: Optional[bool] = None
    early_stopping_patience: Optional[int] = None
    extra: Optional[Dict[str, Any]] = None


@router.get("", dependencies=[_admin])
async def get_config():
    from app.core.config import settings
    cfg = await TrainingConfigDoc.find_one(TrainingConfigDoc.key == "global")
    if cfg:
        return cfg.model_dump()
    # Return defaults from env
    return {
        "key": "global",
        "cuda_device": settings.CUDA_DEVICE,
        "workers": settings.TRAINING_WORKERS,
        "batch_size": settings.TRAINING_BATCH_SIZE,
        "fp16": settings.TRAINING_FP16,
        "max_epochs": settings.TRAINING_MAX_EPOCHS,
        "early_stopping": settings.TRAINING_EARLY_STOPPING,
        "early_stopping_patience": settings.TRAINING_EARLY_STOPPING_PATIENCE,
        "extra": {},
    }


@router.patch("", dependencies=[_admin])
async def update_config(body: UpdateConfigRequest):
    from app.core.config import settings
    cfg = await TrainingConfigDoc.find_one(TrainingConfigDoc.key == "global")
    if not cfg:
        cfg = TrainingConfigDoc(
            cuda_device=settings.CUDA_DEVICE,
            workers=settings.TRAINING_WORKERS,
            batch_size=settings.TRAINING_BATCH_SIZE,
            fp16=settings.TRAINING_FP16,
            max_epochs=settings.TRAINING_MAX_EPOCHS,
            early_stopping=settings.TRAINING_EARLY_STOPPING,
            early_stopping_patience=settings.TRAINING_EARLY_STOPPING_PATIENCE,
        )
        await cfg.insert()

    updates: Dict[str, Any] = {"updated_at": utc_now()}
    for field in ("cuda_device", "workers", "batch_size", "fp16", "max_epochs", "early_stopping", "early_stopping_patience", "extra"):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val
    await cfg.set(updates)
    return cfg.model_dump()


@router.get("/device", dependencies=[_admin])
async def get_active_device():
    """Detect and return the current compute device (cpu/cuda)."""
    from app.core.config import settings
    device = settings.get_device()
    info: Dict[str, Any] = {
        "device": device,
        "cuda_available": False,
        "cuda_device_count": 0,
        "cuda_device_name": None,
        "cuda_devices": [],
        "mps_available": False,
    }
    try:
        import torch
        info["cuda_available"] = torch.cuda.is_available()
        info["cuda_device_count"] = torch.cuda.device_count()
        if torch.cuda.is_available():
            info["cuda_device_name"] = torch.cuda.get_device_name(0)
            devices = []
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                mem_total_gb = round(props.total_memory / 1024 ** 3, 1)
                mem_reserved_gb = round(torch.cuda.memory_reserved(i) / 1024 ** 3, 2)
                mem_allocated_gb = round(torch.cuda.memory_allocated(i) / 1024 ** 3, 2)
                devices.append({
                    "index": i,
                    "name": props.name,
                    "vram_gb": mem_total_gb,
                    "memory_reserved_gb": mem_reserved_gb,
                    "memory_allocated_gb": mem_allocated_gb,
                    "compute_capability": f"{props.major}.{props.minor}",
                    "multi_processor_count": props.multi_processor_count,
                })
            info["cuda_devices"] = devices
        info["mps_available"] = getattr(torch.backends, "mps", None) is not None \
            and torch.backends.mps.is_available()
    except ImportError:
        pass
    return info
