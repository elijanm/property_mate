"""
OTA firmware update API endpoints.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, UploadFile, File, Form
from pydantic import BaseModel
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.ota_update import OTAUpdate, DeviceOTAStatus
from app.services import ota_service
from app.core.exceptions import ResourceNotFoundError
from app.utils.datetime import utc_now

router = APIRouter(prefix="/ota", tags=["ota"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class DeviceOTAStatusResponse(BaseModel):
    device_id: str
    device_uid: str
    status: str
    progress_pct: int
    error: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]


class OTAUpdateResponse(BaseModel):
    id: str
    org_id: str
    device_type_id: str
    target_version: str
    firmware_s3_key: str
    firmware_size_bytes: Optional[int]
    checksum_sha256: Optional[str]
    release_notes: Optional[str]
    device_ids: List[str]
    group_id: Optional[str]
    rollout_pct: int
    status: str
    device_statuses: List[DeviceOTAStatusResponse]
    created_by: str
    created_at: str
    updated_at: str


def _ds_to_response(ds: Any) -> DeviceOTAStatusResponse:
    if isinstance(ds, dict):
        ds = DeviceOTAStatus(**ds)
    return DeviceOTAStatusResponse(
        device_id=ds.device_id,
        device_uid=ds.device_uid,
        status=ds.status,
        progress_pct=ds.progress_pct,
        error=ds.error,
        started_at=ds.started_at.isoformat() if ds.started_at else None,
        completed_at=ds.completed_at.isoformat() if ds.completed_at else None,
    )


def _to_response(ota: OTAUpdate) -> OTAUpdateResponse:
    return OTAUpdateResponse(
        id=str(ota.id),
        org_id=ota.org_id,
        device_type_id=ota.device_type_id,
        target_version=ota.target_version,
        firmware_s3_key=ota.firmware_s3_key,
        firmware_size_bytes=ota.firmware_size_bytes,
        checksum_sha256=ota.checksum_sha256,
        release_notes=ota.release_notes,
        device_ids=ota.device_ids,
        group_id=ota.group_id,
        rollout_pct=ota.rollout_pct,
        status=ota.status,
        device_statuses=[_ds_to_response(ds) for ds in ota.device_statuses],
        created_by=ota.created_by,
        created_at=ota.created_at.isoformat(),
        updated_at=ota.updated_at.isoformat(),
    )


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/firmware/upload", response_model=OTAUpdateResponse, status_code=201,
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def upload_firmware(
    device_type_id: str = Form(...),
    version: str = Form(...),
    release_notes: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload a firmware binary and create a draft OTA update record."""
    content = await file.read()
    ota = await ota_service.upload_firmware(
        file_content=content,
        filename=file.filename or "firmware.bin",
        device_type_id=device_type_id,
        version=version,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        release_notes=release_notes,
    )
    return _to_response(ota)


@router.post("/{ota_id}/start", response_model=OTAUpdateResponse,
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def start_rollout(
    ota_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Activate an OTA rollout: send firmware commands to all target devices."""
    ota = await ota_service.start_ota_rollout(
        ota_id=ota_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
    )
    return _to_response(ota)


@router.post("/{ota_id}/pause", response_model=OTAUpdateResponse,
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def pause_rollout(
    ota_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Pause an active OTA rollout."""
    ota = await ota_service.pause_ota(ota_id=ota_id, org_id=current_user.org_id)
    return _to_response(ota)


@router.delete("/{ota_id}", response_model=OTAUpdateResponse,
               dependencies=[Depends(require_roles("owner", "superadmin"))])
async def cancel_rollout(
    ota_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cancel an OTA rollout and clear pending firmware flags on devices."""
    ota = await ota_service.cancel_ota(ota_id=ota_id, org_id=current_user.org_id)
    return _to_response(ota)


@router.get("", response_model=Dict[str, Any])
async def list_ota_updates(
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
    status: Optional[str] = Query(None),
    device_type_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List OTA updates for the org."""
    filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.role != "superadmin":
        filt["org_id"] = current_user.org_id
    if status:
        filt["status"] = status
    if device_type_id:
        filt["device_type_id"] = device_type_id

    total = await OTAUpdate.find(filt).count()
    updates = await OTAUpdate.find(filt).skip((page - 1) * page_size).limit(page_size).to_list()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_response(u).model_dump() for u in updates],
    }


@router.get("/{ota_id}", response_model=OTAUpdateResponse,
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_ota_update(
    ota_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get an OTA update with per-device progress."""
    ota = await ota_service.get_ota_status(ota_id=ota_id, org_id=current_user.org_id)
    return _to_response(ota)
