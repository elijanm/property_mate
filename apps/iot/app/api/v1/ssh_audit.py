from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
import aioboto3
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.ssh_audit_log import SSHAuditLog
from app.models.ssh_access_request import SSHAccessRequest
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.utils.datetime import utc_now

router = APIRouter(prefix="/ssh-audit", tags=["ssh-audit"])


@router.get("")
async def list_audit_logs(
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
    user_id: Optional[str] = Query(None),
    target_ip: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.role != "superadmin":
        filt["org_id"] = current_user.org_id
    if user_id:
        filt["user_id"] = user_id
    if target_ip:
        filt["destination_ip"] = target_ip

    total = await SSHAuditLog.find(filt).count()
    logs = await SSHAuditLog.find(filt).sort(-SSHAuditLog.session_start).skip((page - 1) * page_size).limit(page_size).to_list()
    return {
        "total": total,
        "items": [
            {
                "id": str(log.id),
                "ssh_request_id": log.ssh_request_id,
                "user_id": log.user_id,
                "user_email": log.user_email,
                "source_ip": log.source_ip,
                "destination_ip": log.destination_ip,
                "session_start": log.session_start.isoformat(),
                "session_end": log.session_end.isoformat() if log.session_end else None,
                "duration_seconds": log.duration_seconds,
                "status": log.status,
                "termination_reason": log.termination_reason,
                "bytes_rx": log.bytes_rx,
                "bytes_tx": log.bytes_tx,
                "commands_count": log.commands_count,
                "has_recording": log.recording_s3_key is not None,
            }
            for log in logs
        ],
    }


# ── SSH Session Recording endpoints ─────────────────────────────────────────

class RecordingUpdateRequest(BaseModel):
    recording_s3_key: str
    recording_format: str = "asciicast"
    bytes_rx: Optional[int] = None
    bytes_tx: Optional[int] = None
    commands_count: Optional[int] = None


async def _find_audit_log(request_id: str, log_id: str, org_id: str) -> SSHAuditLog:
    """Look up an audit log record, verifying it belongs to the given request and org."""
    try:
        log = await SSHAuditLog.find_one({
            "_id": PydanticObjectId(log_id),
            "ssh_request_id": request_id,
            "deleted_at": None,
        })
    except Exception:
        log = None
    if not log:
        raise ResourceNotFoundError("SSHAuditLog", log_id)
    if log.org_id != org_id:
        raise ResourceNotFoundError("SSHAuditLog", log_id)
    return log


@router.post(
    "/ssh-requests/{request_id}/audit/{log_id}/recording-upload-url",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def get_recording_upload_url(
    request_id: str,
    log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Generate a presigned S3 PUT URL so the bastion can upload a session recording.
    S3 path: {org_id}/ssh-recordings/{request_id}/{log_id}.cast
    """
    log = await _find_audit_log(request_id, log_id, current_user.org_id)
    s3_key = f"{current_user.org_id}/ssh-recordings/{request_id}/{log_id}.cast"

    endpoint = settings.s3_public_endpoint_url or settings.s3_endpoint_url
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    ) as s3:
        upload_url = await s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket_name,
                "Key": s3_key,
                "ContentType": "application/octet-stream",
            },
            ExpiresIn=3600,
        )

    return {"upload_url": upload_url, "s3_key": s3_key}


@router.patch(
    "/ssh-requests/{request_id}/audit/{log_id}/recording",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_recording_metadata(
    request_id: str,
    log_id: str,
    body: RecordingUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Update SSH audit log with recording metadata after the bastion has uploaded the file.
    """
    log = await _find_audit_log(request_id, log_id, current_user.org_id)

    updates: Dict[str, Any] = {
        "recording_s3_key": body.recording_s3_key,
        "recording_format": body.recording_format,
        "updated_at": utc_now(),
    }
    if body.bytes_rx is not None:
        updates["bytes_rx"] = body.bytes_rx
    if body.bytes_tx is not None:
        updates["bytes_tx"] = body.bytes_tx
    if body.commands_count is not None:
        updates["commands_count"] = body.commands_count

    await log.set(updates)
    return {"ok": True, "recording_s3_key": body.recording_s3_key}


@router.get(
    "/ssh-requests/{request_id}/audit/{log_id}/replay",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def get_replay_url(
    request_id: str,
    log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Generate a presigned GET URL for the session recording so it can be replayed
    in a terminal player (e.g. asciinema player).
    """
    log = await _find_audit_log(request_id, log_id, current_user.org_id)

    if not log.recording_s3_key:
        raise ValidationError("No recording exists for this session")

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    ) as s3:
        replay_url = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket_name, "Key": log.recording_s3_key},
            ExpiresIn=3600,
        )

    return {
        "replay_url": replay_url,
        "format": log.recording_format,
        "duration_seconds": log.duration_seconds,
    }
