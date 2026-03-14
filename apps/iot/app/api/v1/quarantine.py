"""
Device quarantine API endpoints.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.services import quarantine_service
from app.api.v1.devices import DeviceResponse, _to_response, _fetch_node_maps

router = APIRouter(prefix="/devices", tags=["quarantine"])


class QuarantineRequest(BaseModel):
    reason: str


@router.post(
    "/{device_id}/quarantine",
    response_model=DeviceResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def quarantine_device(
    device_id: str,
    body: QuarantineRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Quarantine a device: kick MQTT session, block auth, block Tailscale access."""
    org_id = current_user.org_id if current_user.role != "superadmin" else None
    # For non-superadmin, org_id enforced inside service
    device = await quarantine_service.quarantine_device(
        device_id=device_id,
        org_id=current_user.org_id,
        reason=body.reason,
        user_id=current_user.user_id,
    )
    node_by_node_id, node_by_uid = await _fetch_node_maps()
    return _to_response(device, node_by_node_id, node_by_uid)


@router.delete(
    "/{device_id}/quarantine",
    response_model=DeviceResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def unquarantine_device(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Remove quarantine from a device, restoring normal authentication."""
    device = await quarantine_service.unquarantine_device(
        device_id=device_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
    )
    node_by_node_id, node_by_uid = await _fetch_node_maps()
    return _to_response(device, node_by_node_id, node_by_uid)
