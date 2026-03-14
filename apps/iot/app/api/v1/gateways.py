import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
import bcrypt as _bcrypt_lib
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.edge_gateway import EdgeGateway
from app.core.exceptions import ResourceNotFoundError, ConflictError
from app.utils.datetime import utc_now
from app.core.redis import get_redis

router = APIRouter(prefix="/gateways", tags=["gateways"])
def _hash_pw(pw: str) -> str:
    return _bcrypt_lib.hashpw(pw.encode(), _bcrypt_lib.gensalt(rounds=12)).decode()



class GatewayCreateRequest(BaseModel):
    name: str
    property_id: str
    gateway_uid: str
    description: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None


class GatewayResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    gateway_uid: str
    name: str
    description: Optional[str]
    model: Optional[str]
    serial_number: Optional[str]
    mqtt_username: str
    mqtt_client_id: str
    tailscale_node_id: Optional[str]
    tailscale_ip: Optional[str]
    tailscale_hostname: Optional[str]
    status: str
    last_seen_at: Optional[str]
    os_version: Optional[str]
    agent_version: Optional[str]
    bridged_device_ids: List[str]
    tb_device_id: Optional[str]
    created_at: str
    updated_at: str


def _to_response(gw: EdgeGateway) -> GatewayResponse:
    return GatewayResponse(
        id=str(gw.id),
        org_id=gw.org_id,
        property_id=gw.property_id,
        gateway_uid=gw.gateway_uid,
        name=gw.name,
        description=gw.description,
        model=gw.model,
        serial_number=gw.serial_number,
        mqtt_username=gw.mqtt_username,
        mqtt_client_id=gw.mqtt_client_id,
        tailscale_node_id=gw.tailscale_node_id,
        tailscale_ip=gw.tailscale_ip,
        tailscale_hostname=gw.tailscale_hostname,
        status=gw.status,
        last_seen_at=gw.last_seen_at.isoformat() if gw.last_seen_at else None,
        os_version=gw.os_version,
        agent_version=gw.agent_version,
        bridged_device_ids=gw.bridged_device_ids,
        tb_device_id=gw.tb_device_id,
        created_at=gw.created_at.isoformat(),
        updated_at=gw.updated_at.isoformat(),
    )


@router.post("", status_code=201, dependencies=[Depends(require_roles("owner", "superadmin"))])
async def create_gateway(body: GatewayCreateRequest, current_user: CurrentUser = Depends(get_current_user)):
    org_id = current_user.org_id
    assert org_id

    existing = await EdgeGateway.find_one({"gateway_uid": body.gateway_uid, "deleted_at": None})
    if existing:
        raise ConflictError(f"gateway_uid '{body.gateway_uid}' already registered")

    raw_password = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    gw = EdgeGateway(
        org_id=org_id,
        property_id=body.property_id,
        gateway_uid=body.gateway_uid,
        name=body.name,
        description=body.description,
        model=body.model,
        serial_number=body.serial_number,
        mqtt_username=body.gateway_uid,
        mqtt_password_hash=_hash_pw(raw_password),
        mqtt_client_id=f"gw:{body.gateway_uid}",
    )
    await gw.insert()
    resp = _to_response(gw)
    return {**resp.model_dump(), "mqtt_password": raw_password}


@router.get("", dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def list_gateways(
    current_user: CurrentUser = Depends(get_current_user),
    property_id: Optional[str] = Query(None),
):
    filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.org_id:
        filt["org_id"] = current_user.org_id
    if property_id:
        filt["property_id"] = property_id
    gws = await EdgeGateway.find(filt).to_list()
    return [_to_response(g).model_dump() for g in gws]


@router.get("/{gateway_id}", dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_gateway(gateway_id: str, current_user: CurrentUser = Depends(get_current_user)):
    gw = await EdgeGateway.find_one({"_id": PydanticObjectId(gateway_id), "deleted_at": None})
    if not gw or (current_user.role != "superadmin" and gw.org_id != current_user.org_id):
        raise ResourceNotFoundError("EdgeGateway", gateway_id)
    return _to_response(gw)


@router.post("/{gateway_id}/rotate-credentials", dependencies=[Depends(require_roles("owner", "superadmin"))])
async def rotate_gateway_credentials(gateway_id: str, current_user: CurrentUser = Depends(get_current_user)):
    gw = await EdgeGateway.find_one({"_id": PydanticObjectId(gateway_id), "deleted_at": None})
    if not gw or (current_user.role != "superadmin" and gw.org_id != current_user.org_id):
        raise ResourceNotFoundError("EdgeGateway", gateway_id)
    new_pw = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    await gw.set({"mqtt_password_hash": _hash_pw(new_pw), "updated_at": utc_now()})
    await get_redis().delete(f"iot:emqx:gw:{gw.mqtt_username}")
    return {"mqtt_password": new_pw}


@router.delete("/{gateway_id}", status_code=204, dependencies=[Depends(require_roles("owner", "superadmin"))])
async def decommission_gateway(gateway_id: str, current_user: CurrentUser = Depends(get_current_user)):
    gw = await EdgeGateway.find_one({"_id": PydanticObjectId(gateway_id), "deleted_at": None})
    if not gw or (current_user.role != "superadmin" and gw.org_id != current_user.org_id):
        raise ResourceNotFoundError("EdgeGateway", gateway_id)
    now = utc_now()
    await gw.set({"status": "decommissioned", "deleted_at": now, "updated_at": now})
    await get_redis().delete(f"iot:emqx:gw:{gw.mqtt_username}")
