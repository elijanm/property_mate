"""Trainer registration endpoints."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
import aiofiles
from pathlib import Path

from app.core.config import settings
from app.dependencies.auth import require_roles, get_current_user
from app.models.trainer_registration import TrainerRegistration
from app.services.registry_service import (
    scan_and_register_plugins,
    list_trainer_classes,
    get_trainer_class,
)
from app.utils.datetime import utc_now
from app.utils.serialization import doc_to_dict

router = APIRouter(prefix="/trainers", tags=["trainers"])


@router.get("/churn_predictor/sample-csv")
async def download_churn_sample_csv(user=Depends(get_current_user)):
    """Return a sample CSV template for the churn predictor dataset."""
    try:
        from trainers.churn_predictor import generate_sample_csv
    except ImportError:
        raise HTTPException(status_code=404, detail="churn_predictor trainer not found")
    csv_bytes = generate_sample_csv()
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=churn_training_sample.csv"},
    )


@router.get("")
async def list_trainers(user=Depends(get_current_user)):
    regs = await TrainerRegistration.find(TrainerRegistration.is_active == True).to_list()  # noqa: E712
    # Filter by org — system trainers (org_id="") are visible to everyone
    regs = [r for r in regs if not r.org_id or r.org_id == user.org_id]
    if user.role == "admin":
        visible = regs
    else:
        # Non-admins see system trainers (no org owner = platform-wide) + their own uploads
        visible = [r for r in regs if not r.org_id or r.owner_email == user.email]
    return {"items": [doc_to_dict(r) for r in visible], "total": len(visible)}


@router.get("/{name}")
async def get_trainer(name: str, user=Depends(get_current_user)):
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    # Non-admin can only see sample trainers or their own
    if user.role != "admin" and not reg.is_sample and reg.owner_email != user.email:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    return doc_to_dict(reg)


@router.post("/upload")
async def upload_trainer_plugin(
    file: UploadFile = File(...),
    user=Depends(require_roles("engineer", "admin")),
):
    """Upload a .py file containing a BaseTrainer subclass."""
    if not file.filename or not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only .py files are accepted")

    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    plugin_dir.mkdir(parents=True, exist_ok=True)
    dest = plugin_dir / file.filename

    content = await file.read()
    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    count = await scan_and_register_plugins(owner_email=user.email, org_id=user.org_id or None)
    # Return the registration record for the uploaded trainer (stem = trainer name candidate)
    stem = Path(file.filename).stem
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == stem)
    trainer_data = doc_to_dict(reg) if reg else None
    return {"uploaded": file.filename, "trainers_registered": count, "trainer": trainer_data}


@router.post("/scan")
async def rescan_plugins(user=Depends(require_roles("engineer", "admin"))):
    """Re-scan the plugin directory for new/updated trainers."""
    count = await scan_and_register_plugins()
    return {"trainers_registered": count}


@router.delete("/{name}")
async def deactivate_trainer(name: str, user=Depends(require_roles("engineer", "admin"))):
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    # Non-admin can only deactivate own trainers
    if user.role != "admin" and reg.owner_email is not None and reg.owner_email != user.email:
        raise HTTPException(status_code=403, detail="You do not have permission to deactivate this trainer")
    await reg.set({"is_active": False, "updated_at": utc_now()})
    return {"deactivated": True}
