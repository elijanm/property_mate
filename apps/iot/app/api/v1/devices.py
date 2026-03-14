import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
import bcrypt as _bcrypt_lib
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.device import Device, DeviceConfig
from app.models.device_type import DeviceType
from app.services import thingsboard_client, headscale_client
import structlog as _structlog
_log = _structlog.get_logger()
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundError, ConflictError, ValidationError
from app.utils.datetime import utc_now
from app.core.redis import get_redis

router = APIRouter(prefix="/devices", tags=["devices"])


def _hash_pw(pw: str) -> str:
    return _bcrypt_lib.hashpw(pw.encode(), _bcrypt_lib.gensalt(rounds=12)).decode()


async def _find_device(device_id: str) -> Optional[Device]:
    """Look up a Device by ObjectId string, device_uid, or mqtt_client_id."""
    try:
        oid = PydanticObjectId(device_id)
        return await Device.find_one({"_id": oid, "deleted_at": None})
    except Exception:
        pass
    # Fall back to device_uid or mqtt_client_id (e.g. UUID-format hardware serial)
    return await Device.find_one({
        "$or": [{"device_uid": device_id}, {"mqtt_client_id": device_id}],
        "deleted_at": None,
    })



# ── Schemas ────────────────────────────────────────────────────────────────

class DeviceCreateRequest(BaseModel):
    name: str
    device_type_id: str
    device_uid: str                   # hardware serial / MAC / custom UID
    property_id: str
    unit_id: Optional[str] = None
    store_location_id: Optional[str] = None
    gateway_id: Optional[str] = None
    description: Optional[str] = None
    serial_number: Optional[str] = None
    inventory_item_id: Optional[str] = None
    inventory_serial_number: Optional[str] = None
    tags: List[str] = []


class DeviceUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    unit_id: Optional[str] = None
    store_location_id: Optional[str] = None
    gateway_id: Optional[str] = None
    config: Optional[DeviceConfig] = None


class TailscaleStatus(BaseModel):
    online: bool
    last_seen: Optional[str]
    ip: Optional[str]
    node_id: Optional[str]
    hostname: Optional[str] = None
    os: Optional[str] = None
    timezone: Optional[str] = None      # from node's register_method / givenName if present
    auto_matched: bool = False          # True = matched by device_uid hostname, not explicit link


class DeviceResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_id: Optional[str]
    store_location_id: Optional[str]
    gateway_id: Optional[str]
    device_type_id: str
    device_type_category: str
    device_uid: str
    name: str
    description: Optional[str]
    serial_number: Optional[str]
    tags: List[str]
    mqtt_username: str
    # mqtt_password_hash is NEVER returned
    mqtt_client_id: str
    capabilities: Dict[str, bool]   # {telemetry, rpc, ota, ssh, attributes, streaming}
    tb_device_id: Optional[str]
    tb_customer_id: Optional[str]
    tailscale_node_id: Optional[str]
    tailscale_ip: Optional[str]
    tailscale_hostname: Optional[str]
    tailscale_status: Optional[TailscaleStatus]   # None if Tailscale not configured/reachable
    status: str
    last_seen_at: Optional[str]
    last_telemetry_at: Optional[str]
    firmware_version: Optional[str]
    ota_pending_version: Optional[str]
    config: DeviceConfig
    created_at: str
    updated_at: str


class ProvisionedDeviceResponse(DeviceResponse):
    """Returned only on create — includes the plaintext MQTT password (shown once)."""
    mqtt_password: str


def _build_tailscale_status(
    device: Device,
    node_by_node_id: Dict[str, Any],   # tailscale_node_id → raw headscale node
    node_by_uid: Dict[str, Any],       # device_uid → raw headscale node (hostname fallback)
) -> Optional[TailscaleStatus]:
    node = None
    auto_matched = False
    if device.tailscale_node_id and device.tailscale_node_id in node_by_node_id:
        node = node_by_node_id[device.tailscale_node_id]
    elif device.device_uid in node_by_uid:
        node = node_by_uid[device.device_uid]
        auto_matched = True
    if node is None:
        return None
    ips = node.get("ipAddresses", [])
    # Headscale stores timezone in the node's givenName field or not at all.
    # We derive it from the OS field if available; otherwise leave None.
    os_str = node.get("os") or node.get("hostInfo", {}).get("os")
    tz_str = node.get("givenName") or None  # some setups store timezone here
    return TailscaleStatus(
        online=node.get("online", False),
        last_seen=node.get("lastSeen"),
        ip=ips[0] if ips else device.tailscale_ip,
        node_id=str(node.get("id", "")),
        hostname=node.get("name"),
        os=os_str,
        timezone=tz_str,
        auto_matched=auto_matched,
    )


_ALL_CAPS = ["telemetry", "rpc", "ota", "ssh", "attributes", "streaming"]

def _caps_to_dict(caps: List[str]) -> Dict[str, bool]:
    """Convert List[str] capabilities stored in the DB to the object shape the frontend expects."""
    cap_set = set(caps or [])
    return {c: (c in cap_set) for c in _ALL_CAPS}


def _to_response(
    device: Device,
    node_by_node_id: Optional[Dict[str, Any]] = None,
    node_by_uid: Optional[Dict[str, Any]] = None,
) -> DeviceResponse:
    ts = (
        _build_tailscale_status(device, node_by_node_id, node_by_uid)
        if node_by_node_id is not None
        else None
    )
    return DeviceResponse(
        id=str(device.id),
        org_id=device.org_id,
        property_id=device.property_id,
        unit_id=device.unit_id,
        store_location_id=device.store_location_id,
        gateway_id=device.gateway_id,
        device_type_id=device.device_type_id,
        device_type_category=device.device_type_category,
        device_uid=device.device_uid,
        name=device.name,
        description=device.description,
        serial_number=device.serial_number,
        tags=device.tags,
        mqtt_username=device.mqtt_username,
        mqtt_client_id=device.mqtt_client_id,
        capabilities=_caps_to_dict(device.capabilities),
        tb_device_id=device.tb_device_id,
        tb_customer_id=device.tb_customer_id,
        tailscale_node_id=device.tailscale_node_id,
        tailscale_ip=device.tailscale_ip,
        tailscale_hostname=device.tailscale_hostname,
        tailscale_status=ts,
        status=device.status,
        last_seen_at=device.last_seen_at.isoformat() if device.last_seen_at else None,
        last_telemetry_at=device.last_telemetry_at.isoformat() if device.last_telemetry_at else None,
        firmware_version=device.firmware_version,
        ota_pending_version=device.ota_pending_version,
        config=device.config,
        created_at=device.created_at.isoformat(),
        updated_at=device.updated_at.isoformat(),
    )


async def _fetch_node_maps() -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Fetch all Headscale nodes and return two lookup dicts.
    Returns (node_by_node_id, node_by_uid). On any error returns empty dicts."""
    try:
        nodes = await headscale_client.list_nodes()
        node_by_node_id = {str(n.get("id", "")): n for n in nodes}
        node_by_uid = {n.get("name", ""): n for n in nodes}  # hostname == device_uid
        return node_by_node_id, node_by_uid
    except Exception as e:
        _log.warning("headscale_unavailable", error=str(e))
        return {}, {}


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("", response_model=ProvisionedDeviceResponse, status_code=201,
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def create_device(body: DeviceCreateRequest, current_user: CurrentUser = Depends(get_current_user)):
    org_id = current_user.org_id
    assert org_id

    # Check uniqueness
    existing = await Device.find_one({"device_uid": body.device_uid, "deleted_at": None})
    if existing:
        raise ConflictError(f"device_uid '{body.device_uid}' already registered")

    # Fetch device type
    device_type = await DeviceType.find_one({"_id": PydanticObjectId(body.device_type_id), "deleted_at": None})
    if not device_type:
        raise ResourceNotFoundError("DeviceType", body.device_type_id)

    # Generate MQTT credentials
    raw_password = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    password_hash = _hash_pw(raw_password)

    device = Device(
        org_id=org_id,
        property_id=body.property_id,
        unit_id=body.unit_id,
        store_location_id=body.store_location_id,
        gateway_id=body.gateway_id,
        device_type_id=body.device_type_id,
        device_type_category=device_type.category,
        device_uid=body.device_uid,
        name=body.name,
        description=body.description,
        serial_number=body.serial_number,
        tags=body.tags,
        mqtt_username=body.device_uid,
        mqtt_password_hash=password_hash,
        mqtt_client_id=f"d:{body.device_uid}",
        capabilities=device_type.capabilities,
    )
    await device.insert()

    if body.inventory_item_id:
        await device.set({"inventory_item_id": body.inventory_item_id, "inventory_serial_number": body.inventory_serial_number})

    # Provision in ThingsBoard (best-effort — don't fail device creation if TB is down)
    try:
        customer_id = await thingsboard_client.get_or_create_customer(
            org_id, body.property_id, body.property_id
        )
        tb_data = await thingsboard_client.provision_device(
            org_id=org_id,
            customer_id=customer_id,
            device_uid=body.device_uid,
            device_name=body.name,
            device_type=device_type.category,
        )
        await device.set({
            "tb_device_id": tb_data["tb_device_id"],
            "tb_access_token": tb_data["tb_access_token"],
            "tb_customer_id": tb_data["tb_customer_id"],
        })
    except Exception as e:
        pass  # TB sync is async — will retry via background job

    # Publish lifecycle event so the PMS worker can stock-out the meter from inventory
    try:
        from app.services.pms_event_publisher import publish_device_lifecycle
        await publish_device_lifecycle(
            event="provisioned",
            org_id=org_id,
            property_id=body.property_id,
            device_id=str(device.id),
            device_uid=body.device_uid,
            unit_id=body.unit_id,
            device_type_category=device_type.category,
            inventory_item_id=body.inventory_item_id,
            inventory_serial_number=body.inventory_serial_number,
        )
    except Exception:
        pass

    resp = _to_response(await Device.get(device.id))
    return ProvisionedDeviceResponse(**resp.model_dump(), mqtt_password=raw_password)


@router.get("", response_model=Dict[str, Any])
async def list_devices(
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
    property_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    org_id = current_user.org_id
    filt: Dict[str, Any] = {"deleted_at": None}
    if org_id:
        filt["org_id"] = org_id
    if property_id:
        filt["property_id"] = property_id
    if status:
        filt["status"] = status
    if category:
        filt["device_type_category"] = category

    node_by_node_id, node_by_uid = await _fetch_node_maps()
    total = await Device.find(filt).count()
    devices = await Device.find(filt).skip((page - 1) * page_size).limit(page_size).to_list()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_response(d, node_by_node_id, node_by_uid).model_dump() for d in devices],
    }


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: str, current_user: CurrentUser = Depends(get_current_user)):
    device = await _find_device(device_id)
    if not device:
        raise ResourceNotFoundError("Device", device_id)
    if current_user.role != "superadmin" and device.org_id != current_user.org_id:
        raise ResourceNotFoundError("Device", device_id)
    node_by_node_id, node_by_uid = await _fetch_node_maps()
    return _to_response(device, node_by_node_id, node_by_uid)


@router.patch("/{device_id}", response_model=DeviceResponse,
              dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def update_device(
    device_id: str,
    body: DeviceUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    updates: Dict[str, Any] = {"updated_at": utc_now()}
    for field in ("name", "description", "tags", "unit_id", "store_location_id", "gateway_id"):
        val = getattr(body, field)
        if val is not None:
            updates[field] = val
    if body.config is not None:
        updates["config"] = body.config.model_dump()

    await device.set(updates)
    # Bust auth cache
    await get_redis().delete(f"iot:emqx:device:{device.mqtt_username}")
    return _to_response(await Device.get(device.id))


@router.post("/{device_id}/rotate-credentials", response_model=Dict[str, str],
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def rotate_credentials(device_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Generate new MQTT password. Returns new plaintext password (shown once)."""
    import httpx as _httpx
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    new_password = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    await device.set({"mqtt_password_hash": _hash_pw(new_password), "updated_at": utc_now()})

    # Kick existing EMQX sessions for this device so the old password is no longer usable
    try:
        async with _httpx.AsyncClient() as _client:
            await _client.delete(
                f"{settings.emqx_api_url}/api/v5/clients/{device.mqtt_client_id}",
                auth=(settings.emqx_api_key, settings.emqx_api_secret),
                timeout=5.0,
            )
    except Exception:
        pass  # non-fatal — old session will be rejected on next publish attempt

    # Clear Redis auth cache so the new hash is picked up immediately on reconnect
    redis = get_redis()
    await redis.delete(f"iot:emqx:device:{device.mqtt_username}")
    await redis.delete(f"iot:auth:{device.mqtt_client_id}")

    return {"mqtt_password": new_password, "note": "Store this password securely — it will not be shown again"}


@router.get("/{device_id}/ssh-setup",
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_ssh_setup(device_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """
    Return SSH setup instructions for a device that supports SSH.

    If the device has 'ssh' in its capabilities this endpoint:
      1. Creates a single-use Headscale pre-auth key (valid 24 h)
      2. Returns the exact `tailscale up` command to run on the device
      3. Explains the SSH access-request flow via POST /ssh-requests

    For devices without SSH capability, returns an informational message.
    """
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    # Common identity block included in every response branch
    identity = {
        "device_id": str(device.id),
        "device_uid": device.device_uid,
        "name": device.name,
    }

    if "ssh" not in device.capabilities:
        return {
            "ssh_supported": False,
            "message": "This device type does not have the 'ssh' capability. "
                       "To enable SSH, update the DeviceType capabilities to include 'ssh'.",
            **identity,
            "capabilities": device.capabilities,
        }

    # Already registered with Tailscale — just return connection info
    if device.tailscale_ip:
        return {
            "ssh_supported": True,
            "already_registered": True,
            **identity,
            "tailscale_ip": device.tailscale_ip,
            "tailscale_hostname": device.device_uid,
            "ssh_command": f"ssh root@{device.tailscale_ip}",
            "ssh_command_named": f"ssh root@{device.device_uid}",  # works if MagicDNS / /etc/hosts is set
            "access_flow": _ssh_access_flow(str(device.id)),
            "note": "Device is already on the Tailscale network. "
                    "Use POST /ssh-requests to request temporary SSH access.",
        }

    # Generate a pre-auth key for this device to join Headscale
    try:
        namespace = settings.headscale_namespace
        key_obj = await headscale_client.create_preauth_key(
            namespace=namespace,
            reusable=False,
            ephemeral=False,
            expiry_hours=24,
        )
        preauth_key = key_obj.get("key", "")
        login_server = settings.headscale_public_url
    except Exception as e:
        return {
            "ssh_supported": True,
            "already_registered": False,
            **identity,
            "error": f"Could not generate pre-auth key: {e}",
            "note": "Headscale may be unavailable. Retry once Headscale is reachable.",
        }

    tailscale_cmd = (
        f"tailscale up "
        f"--login-server={login_server} "
        f"--authkey={preauth_key} "
        f"--hostname={device.device_uid}"
    )

    return {
        "ssh_supported": True,
        "already_registered": False,
        **identity,
        "tailscale_hostname": device.device_uid,   # what the node will appear as in Headscale
        "headscale_login_server": login_server,
        "headscale_namespace": namespace,
        "preauth_key": preauth_key,
        "preauth_key_expires_in": "24 hours (single-use)",
        "setup_steps": [
            "1. Install Tailscale on the device: curl -fsSL https://tailscale.com/install.sh | sh",
            f"2. Register with Headscale: {tailscale_cmd}",
            "3. Wait for the device to appear in GET /tailscale/nodes",
            f"4. Link to PMS: POST /tailscale/nodes/auto-register  {{node_id, entity_type: 'device', entity_id: '{device_id}'}}",
            "5. Request SSH access: POST /ssh-requests  {target_type: 'device', target_id: '<device_id>', reason: '...', requested_duration_m: 60}",
            "6. Owner/admin approves: POST /ssh-requests/{request_id}/approve",
            f"7. SSH in: ssh root@<tailscale_ip>  (or ssh root@{device.device_uid} with MagicDNS)",
        ],
        "tailscale_install_cmd": "curl -fsSL https://tailscale.com/install.sh | sh",
        "tailscale_register_cmd": tailscale_cmd,
        "access_flow": _ssh_access_flow(str(device.id)),
    }


def _ssh_access_flow(device_id: str) -> Dict[str, Any]:
    return {
        "1_request": {
            "method": "POST",
            "path": "/api/v1/ssh-requests",
            "body": {
                "target_type": "device",
                "target_id": device_id,
                "reason": "Describe why you need access",
                "requested_duration_m": 60,
                "requester_tailscale_ip": "<your tailscale IP>",
            },
        },
        "2_approve": {
            "method": "POST",
            "path": "/api/v1/ssh-requests/{request_id}/approve",
            "note": "Owner or superadmin only — adds temporary Headscale ACL rule",
        },
        "3_ssh": {
            "command": "ssh root@<device_tailscale_ip>",
            "note": "Access is time-limited. ACL rule is auto-removed on expiry.",
        },
        "4_revoke": {
            "method": "POST",
            "path": "/api/v1/ssh-requests/{request_id}/revoke",
            "note": "Immediately removes ACL rule before expiry",
        },
    }


@router.post("/{device_id}/tailscale/preauth-key",
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_tailscale_preauth_key(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Generate a fresh Headscale pre-auth key for this device.

    The device uses this key to join the PMS Tailscale network:
      tailscale up --login-server <headscale_public_url> --authkey <key> --hostname <device_uid>

    The key is single-use and expires in 24 hours.
    """
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    namespace = settings.headscale_namespace
    try:
        key_obj = await headscale_client.create_preauth_key(
            namespace=namespace, reusable=False, ephemeral=False, expiry_hours=24
        )
        preauth_key = key_obj.get("key", "")
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"Headscale unavailable: {e}")

    login_server = settings.headscale_public_url.rstrip("/")
    # Docker-compatible login server: replace localhost/127.0.0.1 with host.docker.internal
    import re as _re
    docker_login_server = _re.sub(
        r"(https?://)(?:localhost|127\.0\.0\.1)(:\d+)?",
        lambda m: f"{m.group(1)}host.docker.internal{m.group(2) or ''}",
        login_server,
    )
    ts_up_args = (
        f"--login-server {login_server} "
        f"--authkey {preauth_key} "
        f"--hostname {device.device_uid} "
        f"--accept-routes"
    )
    return {
        "preauth_key": preauth_key,
        "headscale_login_server": login_server,
        "headscale_namespace": namespace,
        # Command to run directly on a Linux/macOS device
        "tailscale_cmd": (
            f"curl -fsSL https://tailscale.com/install.sh | sh && "
            f"tailscale up {ts_up_args}"
        ),
        # Docker test command — starts tailscaled daemon + registers in one shot
        "docker_tailscale_cmd": (
            f"docker run --rm --cap-add NET_ADMIN --cap-add SYS_MODULE \\\n"
            f"  --device /dev/net/tun:/dev/net/tun \\\n"
            f"  tailscale/tailscale:stable \\\n"
            f"  sh -c \"tailscaled --state=mem: --tun=userspace-networking & "
            f"sleep 2 && tailscale up "
            f"--login-server {docker_login_server} "
            f"--authkey {preauth_key} "
            f"--hostname {device.device_uid} "
            f"--accept-routes\""
        ),
        "note": "Single-use key, expires in 24 hours.",
    }


@router.post("/{device_id}/tailscale/sync",
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def sync_tailscale_node(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Scan Headscale nodes and update tailscale_ip / tailscale_node_id for this device.

    Matches by node name == device_uid (set via --hostname flag during tailscale up).
    Call this after the device has successfully joined the Headscale network.
    """
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    try:
        nodes = await headscale_client.list_nodes()
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"Headscale unavailable: {e}")

    # Match node by hostname (set to device_uid during tailscale up --hostname)
    matched = next(
        (n for n in nodes if n.get("name", "").lower() == device.device_uid.lower()),
        None,
    )
    if not matched:
        return {"synced": False, "message": f"No Headscale node found with name '{device.device_uid}'"}

    node_id = str(matched.get("id", ""))
    node_key = matched.get("nodeKey", matched.get("node_key", ""))
    ips = matched.get("ipAddresses", matched.get("ip_addresses", []))
    tailscale_ip = ips[0] if ips else None

    # Extract hostname from Headscale node (givenName is the mutable display name, name is the
    # machine name set at registration time — prefer givenName for display, fall back to name)
    hostname = matched.get("givenName") or matched.get("name") or device.device_uid

    await device.set({
        "tailscale_node_id": node_id,
        "tailscale_node_key": node_key,
        "tailscale_ip": tailscale_ip,
        "tailscale_hostname": hostname,
        "updated_at": utc_now(),
    })

    _log.info("tailscale_node_synced",
              device_uid=device.device_uid, node_id=node_id, tailscale_ip=tailscale_ip,
              hostname=hostname)

    return {
        "synced": True,
        "tailscale_node_id": node_id,
        "tailscale_ip": tailscale_ip,
        "tailscale_hostname": hostname,
    }


# ── Test-script generator ─────────────────────────────────────────────────────

def _make_test_script(
    device: Device,
    mqtt_host: str,
    mqtt_tls_port: int,
    headscale_url: str,
    iot_api_url: str,
    ca_pem: str,
    cert_pem: str,
    key_pem: str,
) -> str:
    uid   = device.device_uid
    org   = device.org_id
    prop  = device.property_id
    cname = f"{uid}_Simulator"

    tt  = f"pms/{org}/{prop}/{uid}/telemetry"
    att = f"pms/{org}/{prop}/{uid}/attributes"
    rpc = f"pms/{org}/{prop}/{uid}/rpc/request"
    rpr = f"pms/{org}/{prop}/{uid}/rpc/response"
    ota = f"pms/{org}/{prop}/{uid}/ota/command"
    ots = f"pms/{org}/{prop}/{uid}/ota/status"

    # Indent PEM blocks to avoid heredoc confusion
    def pem(s: str) -> str:
        return s.strip() if s else "# CA not configured"

    return f"""#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  PMS IoT Device Simulator — {uid}
#  Generated: {utc_now().strftime('%Y-%m-%dT%H:%M:%SZ')}
#
#  USAGE
#    chmod +x {uid}_simulator.sh
#    ./{uid}_simulator.sh            # interactive menu
#    ./{uid}_simulator.sh start      # start container
#    ./{uid}_simulator.sh telemetry  # one telemetry publish
#    ./{uid}_simulator.sh loop [N]   # telemetry loop every N seconds (default 5)
#    ./{uid}_simulator.sh commands   # subscribe to RPC commands
#    ./{uid}_simulator.sh ota        # subscribe to OTA commands
#    ./{uid}_simulator.sh ota-ack    # simulate OTA success
#    ./{uid}_simulator.sh tailscale  # join Headscale VPN
#    ./{uid}_simulator.sh test-all   # automated smoke tests
#    ./{uid}_simulator.sh shell      # open bash inside container
#    ./{uid}_simulator.sh stop       # remove container + certs
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Device config ─────────────────────────────────────────────────────────────
DEVICE_UID="{uid}"
CONTAINER_NAME="{cname}"
CLIENT_ID="d:{uid}"
ORG_ID="{org}"
PROPERTY_ID="{prop}"

MQTT_HOST="{mqtt_host}"
MQTT_TLS_PORT="{mqtt_tls_port}"

TOPIC_TELEMETRY="{tt}"
TOPIC_ATTRIBUTES="{att}"
TOPIC_RPC_REQ="{rpc}"
TOPIC_RPC_RESP="{rpr}"
TOPIC_OTA="{ota}"
TOPIC_OTA_STATUS="{ots}"

HEADSCALE_URL="{headscale_url}"
IOT_API="{iot_api_url}"
DEVICE_ID="{device.id}"

CERT_DIR="${{HOME}}/.pms-sim/{uid}"

# ── Colour helpers ────────────────────────────────────────────────────────────
G="\\033[0;32m"; Y="\\033[1;33m"; R="\\033[0;31m"; C="\\033[0;36m"; B="\\033[1m"; N="\\033[0m"
log() {{ echo -e "${{C}}[SIM]${{N}} $*"; }}
ok()  {{ echo -e "${{G}}[ OK]${{N}} $*"; }}
warn(){{ echo -e "${{Y}}[WRN]${{N}} $*"; }}
err() {{ echo -e "${{R}}[ERR]${{N}} $*"; }}
ts()  {{ date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))"; }}
rand_float() {{ awk "BEGIN{{srand($(ts)); printf \\"%.1f\\",$1+rand()*$2}}"; }}
rand_int()   {{ awk "BEGIN{{srand($(ts)); printf \\"%d\\",$1+int(rand()*$2)}}"; }}

# ── Certificate setup ─────────────────────────────────────────────────────────
setup_certs() {{
  mkdir -p "$CERT_DIR"
  cat > "$CERT_DIR/ca.crt" << 'PEMEOF'
{pem(ca_pem)}
PEMEOF
  cat > "$CERT_DIR/device.crt" << 'PEMEOF'
{pem(cert_pem)}
PEMEOF
  cat > "$CERT_DIR/device.key" << 'PEMEOF'
{pem(key_pem)}
PEMEOF
  chmod 600 "$CERT_DIR/device.key"
  ok "Certificates ready in $CERT_DIR"
}}

# ── Container lifecycle ───────────────────────────────────────────────────────
start() {{
  setup_certs

  if docker ps -q --filter "name=^${{CONTAINER_NAME}}$" 2>/dev/null | grep -q .; then
    ok "Container '$CONTAINER_NAME' is already running"; return 0
  fi
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

  ADD_HOST=""
  [[ "$(uname -s)" == "Linux" ]] && ADD_HOST="--add-host=host.docker.internal:host-gateway"

  log "Starting container '$CONTAINER_NAME' (first run installs tools, ~30 s)..."
  docker run -d \\
    --name "$CONTAINER_NAME" \\
    -v "$CERT_DIR:/certs:ro" \\
    $ADD_HOST \\
    debian:bookworm-slim \\
    bash -c "apt-get update -qq && apt-get install -y -qq mosquitto-clients curl jq openssl iproute2 2>/dev/null && sleep infinity"

  log "Waiting for tools..."
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER_NAME" which mosquitto_pub >/dev/null 2>&1 && {{ ok "Container ready!"; return 0; }}
    sleep 2
  done
  warn "Container up but tools may still be installing."
}}

stop() {{
  docker rm -f "$CONTAINER_NAME" 2>/dev/null && ok "Container removed" || warn "Not running"
  rm -rf "$CERT_DIR" && ok "Certificates removed"
}}

shell() {{ start; log "Opening shell in '$CONTAINER_NAME'..."; docker exec -it "$CONTAINER_NAME" bash; }}

# ── MQTT helpers ──────────────────────────────────────────────────────────────
_pub() {{
  local topic="$1" payload="$2"
  docker exec "$CONTAINER_NAME" mosquitto_pub \\
    -h "$MQTT_HOST" -p "$MQTT_TLS_PORT" \\
    --cafile /certs/ca.crt --cert /certs/device.crt --key /certs/device.key \\
    --insecure -i "$CLIENT_ID" -t "$topic" -m "$payload" -q 1
}}

_sub() {{
  local topic="$1"
  docker exec -it "$CONTAINER_NAME" mosquitto_sub \\
    -h "$MQTT_HOST" -p "$MQTT_TLS_PORT" \\
    --cafile /certs/ca.crt --cert /certs/device.crt --key /certs/device.key \\
    --insecure -i "$CLIENT_ID" -t "$topic" -v
}}

# ── Tests ─────────────────────────────────────────────────────────────────────
telemetry() {{
  start
  local payload
  payload=$(printf '{{"ts":%s,"device_uid":"%s","temperature":%s,"humidity":%s,"battery":%s,"uptime":3600}}' \\
    "$(ts)" "$DEVICE_UID" "$(rand_float 20 10)" "$(rand_int 50 30)" "$(rand_int 70 30)")
  log "→ $TOPIC_TELEMETRY"
  _pub "$TOPIC_TELEMETRY" "$payload"
  ok "Sent: $payload"
}}

loop() {{
  local interval="${{1:-5}}" n=1
  start
  log "Telemetry every ${{interval}}s — Ctrl+C to stop"
  while true; do
    local payload
    payload=$(printf '{{"ts":%s,"device_uid":"%s","temperature":%s,"humidity":%s,"battery":%s,"uptime":%s,"seq":%s}}' \\
      "$(ts)" "$DEVICE_UID" "$(rand_float 20 10)" "$(rand_int 50 30)" "$(rand_int 70 30)" "$((n*interval))" "$n")
    _pub "$TOPIC_TELEMETRY" "$payload"
    ok "[#$n] $payload"
    n=$((n+1)); sleep "$interval"
  done
}}

attributes() {{
  start
  local payload
  payload=$(printf '{{"device_uid":"%s","firmware_version":"1.0.0","hardware_rev":"A","sim_mode":true,"ts":%s}}' \\
    "$DEVICE_UID" "$(ts)")
  log "→ $TOPIC_ATTRIBUTES"
  _pub "$TOPIC_ATTRIBUTES" "$payload"
  ok "Sent: $payload"
}}

commands() {{
  start
  log "Listening for RPC commands on $TOPIC_RPC_REQ  (Ctrl+C to stop)"
  log "Send a command from the PMS dashboard → Device → Commands tab"
  _sub "$TOPIC_RPC_REQ"
}}

ota() {{
  start
  log "Listening for OTA notifications on $TOPIC_OTA  (Ctrl+C to stop)"
  log "Upload firmware in PMS dashboard → IoT → OTA to trigger"
  _sub "$TOPIC_OTA"
}}

ota_ack() {{
  start
  local ver="${{1:-1.0.1-sim}}"
  local payload
  payload=$(printf '{{"status":"success","firmware_version":"%s","ts":%s}}' "$ver" "$(ts)")
  log "→ $TOPIC_OTA_STATUS"
  _pub "$TOPIC_OTA_STATUS" "$payload"
  ok "OTA ack sent: $payload"
}}

tailscale() {{
  start
  log "Fetching a Headscale pre-auth key via PMS IoT API..."
  read -rp "  Paste your PMS JWT token (from browser DevTools → localStorage → pms_token): " JWT
  local resp
  resp=$(curl -sf -X POST "$IOT_API/devices/$DEVICE_ID/tailscale/preauth-key" \\
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json") || {{
    err "Could not fetch pre-auth key — check your token"; return 1
  }}
  local key; key=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('preauth_key',''))" 2>/dev/null)
  [[ -z "$key" ]] && {{ err "No preauth_key in response: $resp"; return 1; }}

  log "Installing Tailscale inside container..."
  docker exec "$CONTAINER_NAME" bash -c "curl -fsSL https://tailscale.com/install.sh | sh" 2>/dev/null || true

  log "Registering with Headscale as '$DEVICE_UID'..."
  docker exec "$CONTAINER_NAME" bash -c "
    tailscaled --state=mem: --tun=userspace-networking &
    sleep 3
    tailscale up --login-server $HEADSCALE_URL --authkey $key --hostname $DEVICE_UID --accept-routes
  "
  ok "Joined Headscale. Click '↺ Sync Tailscale' in the PMS dashboard to update the device record."

  # Auto-configure SSH server so the browser Terminal tab can connect
  setup_ssh "$JWT"
}}

# ── SSH server setup ───────────────────────────────────────────────────────────
setup_ssh() {{
  local JWT="${{1:-}}"
  start
  log "Installing and configuring OpenSSH server in container..."
  docker exec "$CONTAINER_NAME" bash -c "
    apt-get install -y -qq openssh-server 2>/dev/null
    mkdir -p /var/run/sshd /root/.ssh
    chmod 700 /root/.ssh
    # Allow root login via key
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true
    sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true
    echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config
    # Start sshd in background
    pkill sshd 2>/dev/null || true
    /usr/sbin/sshd
    echo 'OpenSSH server started'
  "

  # Fetch IoT console public key and add to authorized_keys
  if [[ -z "$JWT" ]]; then
    read -rp "  Paste your PMS JWT token (needed to fetch console key): " JWT
  fi
  log "Fetching IoT console SSH public key..."
  local pubkey
  pubkey=$(curl -sf "$IOT_API/devices/console-pubkey" \\
    -H "Authorization: Bearer $JWT" 2>/dev/null \\
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('public_key',''))" 2>/dev/null) || pubkey=""

  if [[ -n "$pubkey" ]]; then
    docker exec "$CONTAINER_NAME" bash -c "
      grep -qxF '$pubkey' /root/.ssh/authorized_keys 2>/dev/null || echo '$pubkey' >> /root/.ssh/authorized_keys
      chmod 600 /root/.ssh/authorized_keys
    "
    ok "IoT console public key added to /root/.ssh/authorized_keys"
    ok "Terminal tab in PMS dashboard is now ready to connect."
  else
    warn "Could not fetch console public key — SSH key auth may not work."
    warn "Ensure the IoT service is running and the JWT is valid."
  fi
}}

verify_cert() {{
  start
  docker exec "$CONTAINER_NAME" openssl verify -CAfile /certs/ca.crt /certs/device.crt >/dev/null 2>&1 \\
    && ok "mTLS cert valid (signed by CA)" || warn "Could not verify cert — CA may not be configured"
}}

test_all() {{
  start
  log "════════ Automated smoke tests for $DEVICE_UID ════════"
  telemetry   && ok "1/4 Telemetry   PASS" || err "1/4 Telemetry   FAIL"
  attributes  && ok "2/4 Attributes  PASS" || err "2/4 Attributes  FAIL"
  ota_ack     && ok "3/4 OTA ack     PASS" || err "3/4 OTA ack     FAIL"
  verify_cert
  ok "════════ Done ════════"
}}

# ── Interactive menu ──────────────────────────────────────────────────────────
menu() {{
  echo ""
  echo -e "${{B}}╔══════════════════════════════════════════════════════╗${{N}}"
  echo -e "${{B}}║  PMS IoT Simulator — ${{C}}{uid}${{N}}${{B}}  ║${{N}}"
  echo -e "${{B}}╚══════════════════════════════════════════════════════╝${{N}}"
  echo -e "  ${{C}}1${{N}}  Start simulator container"
  echo -e "  ${{C}}2${{N}}  Send telemetry (once)"
  echo -e "  ${{C}}3${{N}}  Telemetry loop (every 5 s)"
  echo -e "  ${{C}}4${{N}}  Watch for RPC commands"
  echo -e "  ${{C}}5${{N}}  Watch for OTA commands"
  echo -e "  ${{C}}6${{N}}  Simulate OTA success"
  echo -e "  ${{C}}7${{N}}  Report device attributes"
  echo -e "  ${{C}}8${{N}}  Join Tailscale / Headscale VPN + SSH setup"
  echo -e "  ${{C}}9${{N}}  Run all smoke tests"
  echo -e "  ${{C}}t${{N}}  Setup SSH server only (if already on VPN)"
  echo -e "  ${{C}}s${{N}}  Open container shell"
  echo -e "  ${{C}}0${{N}}  Stop & remove container + certs"
  echo -e "  ${{C}}q${{N}}  Quit"
  echo ""
  read -rp "  → " CHOICE
  case $CHOICE in
    1) start ;;      2) telemetry ;;   3) loop 5 ;;
    4) commands ;;   5) ota ;;         6) ota_ack ;;
    7) attributes ;; 8) tailscale ;;   9) test_all ;;
    t|T) setup_ssh ;;
    s|S) shell ;;    0) stop ;;        q|Q) exit 0 ;;
    *) warn "Unknown: $CHOICE" ;;
  esac
  menu
}}

# ── Entrypoint ────────────────────────────────────────────────────────────────
case "${{1:-menu}}" in
  start)      start ;;
  stop)       stop ;;
  shell)      shell ;;
  telemetry)  telemetry ;;
  loop)       loop "${{2:-5}}" ;;
  commands)   commands ;;
  ota)        ota ;;
  ota-ack)    ota_ack "${{2:-1.0.1-sim}}" ;;
  attributes) attributes ;;
  tailscale)  tailscale ;;
  ssh-setup)  setup_ssh ;;
  test-all)   test_all ;;
  menu|*)     menu ;;
esac
"""


@router.get("/{device_id}/test-script",
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def download_test_script(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Generate and download a self-contained shell simulator for this device.

    The script:
      - Creates a Docker container named <DEVICE_UID>_Simulator
      - Embeds mTLS certificates (fresh 30-day test cert issued by the internal CA)
      - Provides commands for telemetry, RPC, OTA, Tailscale join, and smoke tests
    """
    import re as _re
    from fastapi.responses import Response
    from app.services import ca_service

    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    # Issue a fresh 30-day test cert — does not overwrite device DB records
    ca_pem = cert_pem = key_pem = ""
    try:
        ca_pem   = await ca_service.get_ca_cert_pem()
        certs    = await ca_service.issue_device_cert(device.device_uid, device.org_id, validity_days=30)
        cert_pem = certs["cert_pem"]
        key_pem  = certs["key_pem"]
    except Exception:
        pass  # CA not configured — script still works (mTLS section will show placeholder)

    # Resolve Docker-compatible host URLs
    def _docker_host(url: str) -> str:
        return _re.sub(
            r"(https?://)(?:localhost|127\.0\.0\.1)(:\d+)?",
            lambda m: f"{m.group(1)}host.docker.internal{m.group(2) or ''}",
            url,
        )

    mqtt_host = settings.mqtt_broker_host
    if mqtt_host in ("localhost", "127.0.0.1", "emqx"):
        mqtt_host = "host.docker.internal"

    iot_api_url = _docker_host(settings.iot_service_public_url.rstrip("/") + "/api/v1")

    script = _make_test_script(
        device=device,
        mqtt_host=mqtt_host,
        mqtt_tls_port=8883,
        headscale_url=_docker_host(settings.headscale_public_url.rstrip("/")),
        iot_api_url=iot_api_url,
        ca_pem=ca_pem,
        cert_pem=cert_pem,
        key_pem=key_pem,
    )

    filename = f"{device.device_uid}_simulator.sh"
    return Response(
        content=script.encode(),
        media_type="text/x-shellscript",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/{device_id}/last-telemetry",
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_last_telemetry(device_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Return the most recent telemetry payload received from this device (cached in Redis, TTL 5 min)."""
    import json as _json
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)
    raw = await get_redis().get(f"iot:device:{device.id}:last_telemetry")
    if not raw:
        return {"data": None, "ts": None}
    try:
        return _json.loads(raw)
    except Exception:
        return {"data": None, "ts": None}


@router.delete("/{device_id}", status_code=204,
               dependencies=[Depends(require_roles("owner", "superadmin"))])
async def decommission_device(device_id: str, current_user: CurrentUser = Depends(get_current_user)):
    device = await _find_device(device_id)
    if not device or (current_user.role != "superadmin" and device.org_id != current_user.org_id):
        raise ResourceNotFoundError("Device", device_id)

    now = utc_now()
    await device.set({"status": "decommissioned", "deleted_at": now, "updated_at": now})
    await get_redis().delete(f"iot:emqx:device:{device.mqtt_username}")
    # Remove from ThingsBoard (best-effort)
    if device.tb_device_id:
        try:
            await thingsboard_client.delete_device(device.org_id, device.tb_device_id)
        except Exception:
            pass

    # Stock device back into inventory on decommission
    try:
        from app.services.pms_event_publisher import publish_device_lifecycle
        await publish_device_lifecycle(
            event="decommissioned",
            org_id=device.org_id,
            property_id=device.property_id,
            device_id=str(device.id),
            device_uid=device.device_uid,
            unit_id=device.unit_id,
            device_type_category=device.device_type_category,
            inventory_item_id=device.inventory_item_id,
            inventory_serial_number=device.inventory_serial_number,
        )
    except Exception:
        pass
