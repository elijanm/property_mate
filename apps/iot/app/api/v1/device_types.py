from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.device_type import DeviceType, TelemetryField, RpcCommand
from app.core.exceptions import ResourceNotFoundError, ConflictError
from app.utils.datetime import utc_now

router = APIRouter(prefix="/device-types", tags=["device-types"])


class DeviceTypeCreateRequest(BaseModel):
    name: str
    category: str
    protocol: str = "mqtt"
    telemetry_schema: List[TelemetryField] = []
    attribute_schema: List[TelemetryField] = []
    capabilities: List[str] = []
    rpc_commands: List[RpcCommand] = []
    ota_supported: bool = False
    icon: Optional[str] = None
    description: Optional[str] = None


class DeviceTypeUpdateRequest(BaseModel):
    name: Optional[str] = None
    telemetry_schema: Optional[List[TelemetryField]] = None
    attribute_schema: Optional[List[TelemetryField]] = None
    capabilities: Optional[List[str]] = None
    rpc_commands: Optional[List[RpcCommand]] = None
    ota_supported: Optional[bool] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", response_model=List[Dict[str, Any]])
async def list_device_types(
    current_user: CurrentUser = Depends(get_current_user),
    category: Optional[str] = Query(None),
):
    """Return platform-level types + org-scoped types."""
    filters: List[Dict] = [{"deleted_at": None}]
    org_filt: Dict = {"$or": [{"org_id": None}, {"org_id": current_user.org_id}]}
    filt = {"$and": filters + [org_filt]}
    if category:
        filt["category"] = category
    types = await DeviceType.find(filt).to_list()
    return [{**t.model_dump(mode="json"), "id": str(t.id)} for t in types]


@router.post("", status_code=201, dependencies=[Depends(require_roles("owner", "superadmin"))])
async def create_device_type(body: DeviceTypeCreateRequest, current_user: CurrentUser = Depends(get_current_user)):
    # Superadmin can create platform-level (org_id=None), others create org-scoped
    org_id = None if current_user.role == "superadmin" else current_user.org_id
    dt = DeviceType(**body.model_dump(), org_id=org_id)
    await dt.insert()
    return {**dt.model_dump(mode="json"), "id": str(dt.id)}


@router.patch("/{type_id}", dependencies=[Depends(require_roles("owner", "superadmin"))])
async def update_device_type(
    type_id: str, body: DeviceTypeUpdateRequest, current_user: CurrentUser = Depends(get_current_user)
):
    dt = await DeviceType.find_one({"_id": PydanticObjectId(type_id), "deleted_at": None})
    if not dt:
        raise ResourceNotFoundError("DeviceType", type_id)
    if current_user.role != "superadmin" and dt.org_id != current_user.org_id:
        raise ResourceNotFoundError("DeviceType", type_id)

    updates: Dict[str, Any] = {"updated_at": utc_now()}
    for field in ("name", "telemetry_schema", "attribute_schema", "capabilities", "rpc_commands", "ota_supported", "icon", "description", "is_active"):
        val = getattr(body, field)
        if val is not None:
            updates[field] = val.model_dump() if hasattr(val, "model_dump") else val
    await dt.set(updates)
    updated = await DeviceType.get(dt.id)
    return {**updated.model_dump(mode="json"), "id": str(updated.id)}


@router.delete("/{type_id}", status_code=204, dependencies=[Depends(require_roles("owner", "superadmin"))])
async def delete_device_type(type_id: str, current_user: CurrentUser = Depends(get_current_user)):
    dt = await DeviceType.find_one({"_id": PydanticObjectId(type_id), "deleted_at": None})
    if not dt or (current_user.role != "superadmin" and dt.org_id != current_user.org_id):
        raise ResourceNotFoundError("DeviceType", type_id)
    await dt.set({"deleted_at": utc_now()})
