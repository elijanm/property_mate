"""
Tailscale / Headscale node management.
Also provides auto-registration of nodes as devices or gateways.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from beanie import PydanticObjectId
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.services import headscale_client
from app.models.device import Device
from app.models.edge_gateway import EdgeGateway
from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.utils.datetime import utc_now

router = APIRouter(prefix="/tailscale", tags=["tailscale"])


class AutoRegisterRequest(BaseModel):
    node_id: str                        # Headscale node ID
    entity_type: str                    # device | gateway
    entity_id: str                      # Device or EdgeGateway _id
    org_id: Optional[str] = None        # required if superadmin call


class NodeResponse(BaseModel):
    node_id: str
    name: str
    hostname: Optional[str]
    ip_addresses: List[str]
    online: bool
    last_seen: Optional[str]
    os: Optional[str]
    entity_type: Optional[str]          # device | gateway | unregistered
    entity_id: Optional[str]
    auto_matched: bool = False          # True when matched by hostname, not explicit registration


def _map_node(
    node: Dict,
    device_map: Dict[str, str],       # tailscale_node_id → device_id
    gw_map: Dict[str, str],           # tailscale_node_id → gateway_id
    uid_device_map: Dict[str, str],   # device_uid → device_id (for hostname fallback)
    uid_gw_map: Dict[str, str],       # gateway_uid → gateway_id (for hostname fallback)
) -> Dict[str, Any]:
    node_id = str(node.get("id", ""))
    hostname = node.get("name", "")
    ips = node.get("ipAddresses", [])
    entity_type = None
    entity_id = None
    auto_matched = False

    if node_id in device_map:
        entity_type, entity_id = "device", device_map[node_id]
    elif node_id in gw_map:
        entity_type, entity_id = "gateway", gw_map[node_id]
    elif hostname in uid_device_map:
        # Hostname matches a device_uid — node joined but auto-register not yet called
        entity_type, entity_id, auto_matched = "device", uid_device_map[hostname], True
    elif hostname in uid_gw_map:
        entity_type, entity_id, auto_matched = "gateway", uid_gw_map[hostname], True

    return {
        "node_id": node_id,
        "name": hostname,
        "hostname": hostname,
        "ip_addresses": ips,
        "online": node.get("online", False),
        "last_seen": node.get("lastSeen"),
        "os": node.get("os"),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "auto_matched": auto_matched,
    }


@router.get("/nodes")
async def list_tailscale_nodes(
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    """List all Headscale nodes. Nodes are matched to devices/gateways by tailscale_node_id
    (explicit) or by hostname == device_uid (auto-matched, pending auto-register)."""
    nodes = await headscale_client.list_nodes()

    org_filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.role != "superadmin":
        org_filt["org_id"] = current_user.org_id

    all_devices = await Device.find(org_filt).to_list()
    all_gateways = await EdgeGateway.find(org_filt).to_list()

    # node_id-based maps (explicit registrations)
    device_map = {d.tailscale_node_id: str(d.id) for d in all_devices if d.tailscale_node_id}
    gw_map = {g.tailscale_node_id: str(g.id) for g in all_gateways if g.tailscale_node_id}

    # uid-based maps (hostname fallback for unregistered nodes)
    uid_device_map = {d.device_uid: str(d.id) for d in all_devices}
    uid_gw_map = {g.gateway_uid: str(g.id) for g in all_gateways}

    return [_map_node(n, device_map, gw_map, uid_device_map, uid_gw_map) for n in nodes]


@router.post("/nodes/auto-register")
async def auto_register_node(
    body: AutoRegisterRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    """
    Associate a Headscale node with an existing Device or EdgeGateway record.
    Fetches node details from Headscale and updates the entity with Tailscale IP/node_id.
    """
    org_id = body.org_id if current_user.role == "superadmin" and body.org_id else current_user.org_id

    # Fetch node from Headscale
    node = await headscale_client.get_node(body.node_id)
    ips = node.get("ipAddresses", [])
    tailscale_ip = ips[0] if ips else None

    now = utc_now()
    update = {
        "tailscale_node_id": body.node_id,
        "tailscale_node_key": node.get("nodeKey"),
        "tailscale_ip": tailscale_ip,
        "tailscale_hostname": node.get("name"),
        "updated_at": now,
    }

    if body.entity_type == "device":
        entity = await Device.find_one({"_id": PydanticObjectId(body.entity_id), "org_id": org_id, "deleted_at": None})
        if not entity:
            raise ResourceNotFoundError("Device", body.entity_id)
        await entity.set(update)
        return {"status": "registered", "entity_type": "device", "entity_id": body.entity_id, "tailscale_ip": tailscale_ip}

    elif body.entity_type == "gateway":
        gw = await EdgeGateway.find_one({"_id": PydanticObjectId(body.entity_id), "org_id": org_id, "deleted_at": None})
        if not gw:
            raise ResourceNotFoundError("EdgeGateway", body.entity_id)
        await gw.set({**update, "tailscale_registered_at": now})
        return {"status": "registered", "entity_type": "gateway", "entity_id": body.entity_id, "tailscale_ip": tailscale_ip}

    raise ValidationError(f"Unknown entity_type: {body.entity_type}")


@router.delete("/nodes/{node_id}", status_code=204,
               dependencies=[Depends(require_roles("superadmin"))])
async def remove_node(node_id: str):
    """Deregister a node from Headscale (use with decommissioned devices)."""
    await headscale_client.delete_node(node_id)
