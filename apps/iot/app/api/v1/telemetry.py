"""Proxy telemetry queries to ThingsBoard."""
from fastapi import APIRouter, Depends, Query
from beanie import PydanticObjectId
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.device import Device
from app.services import thingsboard_client
from app.core.exceptions import ResourceNotFoundError, ValidationError
import time

router = APIRouter(prefix="/devices/{device_id}/telemetry", tags=["telemetry"])


@router.get("")
async def get_telemetry(
    device_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
    keys: str = Query(..., description="Comma-separated telemetry keys"),
    start_ts: int = Query(default=None, description="Start timestamp ms"),
    end_ts: int = Query(default=None, description="End timestamp ms"),
):
    device = await Device.find_one({"_id": PydanticObjectId(device_id), "deleted_at": None})
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    if not device.tb_device_id:
        raise ValidationError("Device is not yet provisioned in ThingsBoard")

    now_ms = int(time.time() * 1000)
    _start = start_ts or (now_ms - 86_400_000)  # default: last 24h
    _end = end_ts or now_ms

    return await thingsboard_client.get_telemetry(
        org_id=device.org_id,
        tb_device_id=device.tb_device_id,
        keys=keys,
        start_ts=_start,
        end_ts=_end,
    )
