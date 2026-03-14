"""
Device group / fleet management API endpoints.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.device_group import DeviceGroup
from app.services import fleet_service
from app.api.v1.commands import CommandResponse, _to_cmd_resp
from app.utils.datetime import utc_now

router = APIRouter(prefix="/fleets", tags=["fleets"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class DeviceGroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    property_id: Optional[str] = None
    device_ids: List[str] = []
    tag_filter: Optional[str] = None
    tags: List[str] = []


class DeviceGroupUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    property_id: Optional[str] = None
    tag_filter: Optional[str] = None
    tags: Optional[List[str]] = None


class DeviceGroupResponse(BaseModel):
    id: str
    org_id: str
    property_id: Optional[str]
    name: str
    description: Optional[str]
    tags: List[str]
    device_ids: List[str]
    tag_filter: Optional[str]
    member_count: Optional[int]
    created_by: str
    created_at: str
    updated_at: str


class BulkDeviceRequest(BaseModel):
    device_ids: List[str]


class BulkCommandRequest(BaseModel):
    command_name: str
    params: Dict[str, Any] = {}
    timeout_s: int = 30


class BulkQuarantineRequest(BaseModel):
    reason: str


def _to_response(group: DeviceGroup, member_count: Optional[int] = None) -> DeviceGroupResponse:
    return DeviceGroupResponse(
        id=str(group.id),
        org_id=group.org_id,
        property_id=group.property_id,
        name=group.name,
        description=group.description,
        tags=group.tags,
        device_ids=group.device_ids,
        tag_filter=group.tag_filter,
        member_count=member_count,
        created_by=group.created_by,
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("", response_model=DeviceGroupResponse, status_code=201,
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def create_group(
    body: DeviceGroupCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    group = await fleet_service.create_group(
        org_id=current_user.org_id,
        name=body.name,
        user_id=current_user.user_id,
        description=body.description,
        device_ids=body.device_ids,
        tag_filter=body.tag_filter,
        property_id=body.property_id,
        tags=body.tags,
    )
    return _to_response(group)


@router.get("", response_model=Dict[str, Any])
async def list_groups(
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
    property_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    org_id = current_user.org_id
    groups = await fleet_service.list_groups(org_id=org_id, property_id=property_id)
    total = len(groups)
    paged = groups[(page - 1) * page_size: page * page_size]
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_response(g).model_dump() for g in paged],
    }


@router.get("/{group_id}", response_model=DeviceGroupResponse,
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_group(
    group_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    group = await fleet_service.get_group(group_id=group_id, org_id=current_user.org_id)
    members = await fleet_service.resolve_members(group, org_id=current_user.org_id)
    return _to_response(group, member_count=len(members))


@router.patch("/{group_id}", response_model=DeviceGroupResponse,
              dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def update_group(
    group_id: str,
    body: DeviceGroupUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    data = body.model_dump(exclude_none=True)
    group = await fleet_service.update_group(
        group_id=group_id,
        org_id=current_user.org_id,
        data=data,
    )
    return _to_response(group)


@router.delete("/{group_id}", status_code=204,
               dependencies=[Depends(require_roles("owner", "superadmin"))])
async def delete_group(
    group_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    await fleet_service.delete_group(group_id=group_id, org_id=current_user.org_id)


@router.post("/{group_id}/devices", response_model=DeviceGroupResponse,
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def add_devices(
    group_id: str,
    body: BulkDeviceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Add devices to the group by their IDs."""
    group = await fleet_service.add_devices(
        group_id=group_id,
        org_id=current_user.org_id,
        device_ids=body.device_ids,
    )
    return _to_response(group)


@router.delete("/{group_id}/devices", response_model=DeviceGroupResponse,
               dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def remove_devices(
    group_id: str,
    body: BulkDeviceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Remove devices from the group by their IDs."""
    group = await fleet_service.remove_devices(
        group_id=group_id,
        org_id=current_user.org_id,
        device_ids=body.device_ids,
    )
    return _to_response(group)


@router.post("/{group_id}/commands", response_model=List[CommandResponse],
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def bulk_command(
    group_id: str,
    body: BulkCommandRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Send an RPC command to all online, RPC-capable devices in the group."""
    commands = await fleet_service.bulk_command(
        group_id=group_id,
        org_id=current_user.org_id,
        command_name=body.command_name,
        params=body.params,
        user_id=current_user.user_id,
        timeout_s=body.timeout_s,
    )
    return [_to_cmd_resp(c) for c in commands]


@router.post("/{group_id}/quarantine", response_model=Dict[str, int],
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def bulk_quarantine(
    group_id: str,
    body: BulkQuarantineRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Quarantine all non-quarantined devices in the group."""
    result = await fleet_service.bulk_quarantine(
        group_id=group_id,
        org_id=current_user.org_id,
        reason=body.reason,
        user_id=current_user.user_id,
    )
    return result
