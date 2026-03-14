"""
IoT Sync API

POST /sync/register-device
    Registers a device across the full IoT stack in one call:
      MongoDB Device → MQTT credentials → ThingsBoard Tenant/Customer/Asset/Device
    Returns the provisioned device with the MQTT password (shown once) and
    the ThingsBoard access token.

GET  /sync/connectivity
    Tests connectivity to every external service the IoT service depends on:
    MongoDB, Redis, EMQX (management API + MQTT port), ThingsBoard, Headscale,
    RabbitMQ. Returns per-service status and an "overall" verdict.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.services import sync_service, connectivity, headscale_client

router = APIRouter(prefix="/sync", tags=["sync"])


# ── Request / Response schemas ──────────────────────────────────────────────

class RegisterDeviceRequest(BaseModel):
    # Device identity
    device_uid: str          # hardware serial / MAC / custom UID (globally unique)
    device_name: str
    device_type_id: str      # DeviceType MongoDB ObjectId

    # Placement
    property_id: str
    property_name: str       # used to provision ThingsBoard Customer
    unit_id: Optional[str] = None
    unit_name: Optional[str] = None   # used to provision ThingsBoard Asset
    store_location_id: Optional[str] = None
    gateway_id: Optional[str] = None

    # Organisation (only required for superadmin cross-org calls)
    org_id: Optional[str] = None
    org_name: Optional[str] = None

    # Metadata
    description: Optional[str] = None
    serial_number: Optional[str] = None
    tags: List[str] = []

    # Capability overrides — if omitted, device_type.capabilities are used as-is
    # e.g. {"telemetry": True, "ssh": True, "rpc": False, "ota": False}
    capabilities: Optional[Dict[str, bool]] = None


class SyncStepOut(BaseModel):
    name: str
    status: str      # "ok" | "skipped" | "error"
    detail: str = ""
    external_id: str = ""


class RegisterDeviceResponse(BaseModel):
    status: str                  # "provisioned" | "partial"
    device_id: str
    device_uid: str
    org_id: str
    property_id: str
    unit_id: Optional[str]

    # MQTT — password is shown only in this response; store it securely
    mqtt_username: str
    mqtt_password: str
    mqtt_client_id: str
    mqtt_broker_host: str
    mqtt_broker_port: int

    # mTLS / X.509 — shown only in this response; store cert + key securely
    # None when the internal CA is unavailable (password auth still works)
    device_cert_pem: Optional[str] = None   # PEM client certificate → write to /etc/device.crt
    device_key_pem: Optional[str] = None    # PEM private key       → write to /etc/device.key
    cert_fingerprint: Optional[str] = None  # SHA-256 fingerprint
    cert_expires_at: Optional[str] = None   # ISO-8601 expiry

    # ThingsBoard
    tb_device_id: Optional[str]
    tb_access_token: Optional[str]
    tb_tenant_id: Optional[str]
    tb_customer_id: Optional[str]
    tb_asset_id: Optional[str]
    tb_dashboard_url: Optional[str]

    # Audit trail
    steps: List[SyncStepOut]
    note: str = ""

    # SSH setup (only present when device has 'ssh' capability)
    ssh_setup: Optional[Dict[str, Any]] = None


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/register-device", response_model=RegisterDeviceResponse, status_code=201,
             summary="Register a device across the full IoT stack")
async def register_device(
    body: RegisterDeviceRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    """
    Single endpoint that performs the entire device on-boarding flow:

    1. Validates device_uid uniqueness
    2. Resolves the DeviceType record
    3. Provisions ThingsBoard hierarchy: Org→Tenant, Property→Customer, Unit→Asset
    4. Creates the Device document in MongoDB with bcrypt MQTT credentials
    5. Provisions the Device in ThingsBoard and retrieves its access token
    6. Returns everything in one response — save `mqtt_password` and
       `tb_access_token`; they cannot be retrieved again later.

    If ThingsBoard is temporarily unavailable the device is still created in
    MongoDB (so MQTT auth works immediately) and `status` is `"partial"`.
    The ThingsBoard sync can be retried later via PATCH /devices/{id}/sync.
    """
    from app.core.config import settings as cfg

    org_id = body.org_id if current_user.role == "superadmin" and body.org_id else current_user.org_id
    org_name = body.org_name or org_id

    # Convert capabilities dict to list if provided (e.g. {"telemetry": True, "ssh": False} → ["telemetry"])
    capabilities_list: Optional[List[str]] = None
    if body.capabilities is not None:
        capabilities_list = [k for k, v in body.capabilities.items() if v]

    result = await sync_service.register_device(
        org_id=org_id,
        org_name=org_name,
        property_id=body.property_id,
        property_name=body.property_name,
        device_uid=body.device_uid,
        device_name=body.device_name,
        device_type_id=body.device_type_id,
        unit_id=body.unit_id,
        unit_name=body.unit_name,
        store_location_id=body.store_location_id,
        gateway_id=body.gateway_id,
        description=body.description,
        serial_number=body.serial_number,
        tags=body.tags,
        capabilities=capabilities_list,
    )

    tb_url = cfg.thingsboard_url.rstrip("/")
    tb_dashboard_url = (
        f"{tb_url}/devices?deviceId={result.tb_device_id}"
        if result.tb_device_id else None
    )

    # Build SSH setup block if device has ssh capability
    ssh_setup: Optional[Dict[str, Any]] = None
    try:
        from app.models.device import Device
        from beanie import PydanticObjectId as _OID
        _dev = await Device.get(_OID(result.device_id))
        if _dev and "ssh" in _dev.capabilities:
            ssh_setup = await _build_ssh_setup(result.device_id, body.device_uid)
    except Exception:
        pass

    note = (
        "Device is fully provisioned across all systems."
        if result.status == "provisioned"
        else "Device created in MongoDB (MQTT ready). ThingsBoard sync incomplete — "
             "check the 'steps' for details. Retry via PATCH /devices/{id}/sync."
    )

    return RegisterDeviceResponse(
        status=result.status,
        device_id=result.device_id,
        device_uid=result.device_uid,
        org_id=result.org_id,
        property_id=result.property_id,
        unit_id=result.unit_id,
        mqtt_username=result.mqtt_username,
        mqtt_password=result.mqtt_password,
        mqtt_client_id=result.mqtt_client_id,
        mqtt_broker_host=cfg.mqtt_broker_host,
        mqtt_broker_port=cfg.mqtt_broker_port,
        device_cert_pem=result.device_cert_pem,
        device_key_pem=result.device_key_pem,
        cert_fingerprint=result.cert_fingerprint,
        cert_expires_at=result.cert_expires_at,
        tb_device_id=result.tb_device_id,
        tb_access_token=result.tb_access_token,
        tb_tenant_id=result.tb_tenant_id,
        tb_customer_id=result.tb_customer_id,
        tb_asset_id=result.tb_asset_id,
        tb_dashboard_url=tb_dashboard_url,
        steps=[SyncStepOut(**s.__dict__) for s in result.steps],
        note=note,
        ssh_setup=ssh_setup,
    )


# ── SSH setup helper ─────────────────────────────────────────────────────────

async def _build_ssh_setup(device_id: str, device_uid: str) -> Dict[str, Any]:
    """Generate Headscale pre-auth key and return SSH setup instructions."""
    from app.core.config import settings as cfg
    try:
        namespace = cfg.headscale_namespace
        await headscale_client.ensure_user(namespace)
        key_obj = await headscale_client.create_preauth_key(
            namespace=namespace,
            reusable=False,
            ephemeral=False,
            expiry_hours=24,
        )
        preauth_key = key_obj.get("key", "")
        login_server = cfg.headscale_public_url
        tailscale_cmd = (
            f"tailscale up "
            f"--login-server={login_server} "
            f"--authkey={preauth_key} "
            f"--hostname={device_uid}"
        )
        return {
            "headscale_login_server": login_server,
            "headscale_namespace": namespace,
            "preauth_key": preauth_key,
            "preauth_key_expires_in": "24 hours (single-use)",
            "tailscale_install_cmd": "curl -fsSL https://tailscale.com/install.sh | sh",
            "tailscale_register_cmd": tailscale_cmd,
            "setup_steps": [
                "1. Install Tailscale on the device: curl -fsSL https://tailscale.com/install.sh | sh",
                f"2. Register: {tailscale_cmd}",
                "3. Confirm node appears: GET /api/v1/tailscale/nodes",
                f"4. Link node to device: POST /api/v1/tailscale/nodes/auto-register",
                f"5. Request SSH access: POST /api/v1/ssh-requests",
                "6. Owner approves: POST /api/v1/ssh-requests/{{request_id}}/approve",
                "7. Connect: ssh root@<tailscale_ip>",
            ],
            "ssh_access_flow": {
                "request": f"POST /api/v1/ssh-requests  {{target_type:'device', target_id:'{device_id}', reason:'...', requested_duration_m:60}}",
                "approve": "POST /api/v1/ssh-requests/{request_id}/approve  [owner/superadmin]",
                "connect": "ssh root@<device_tailscale_ip>",
                "revoke": "POST /api/v1/ssh-requests/{request_id}/revoke",
            },
            "refresh_cmd": f"GET /api/v1/devices/{device_id}/ssh-setup  (regenerates pre-auth key)",
        }
    except Exception as e:
        return {
            "error": f"SSH setup unavailable: {e}",
            "note": "Headscale may be down. Retry via GET /api/v1/devices/{device_id}/ssh-setup",
        }


@router.get("/ca-cert", summary="Return the IoT CA certificate PEM for mTLS device authentication")
async def get_ca_cert(
    _: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Returns the IoT CA certificate in PEM format.  Clients use this to verify
    the MQTT broker's TLS certificate and to authenticate their own client cert
    (issued at device registration) against the broker.

    Save the returned ``ca_cert_pem`` as ``ca.crt`` on the device / test host.
    """
    from app.services import ca_service
    try:
        pem = await ca_service.get_ca_cert_pem()
        return {"ca_cert_pem": pem}
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"CA not configured: {exc}")


@router.get("/connectivity", summary="Test connectivity to all external services")
async def test_connectivity(
    _: CurrentUser = Depends(require_roles("owner", "superadmin")),
) -> Dict[str, Any]:
    """
    Probes every service the IoT stack depends on and returns per-service status:

    | Service       | What is checked                                     |
    |---------------|-----------------------------------------------------|
    | mongodb       | `db.ping()` round-trip                              |
    | redis         | `PING` with latency measurement                     |
    | emqx          | `GET /api/v5/status` on management API (port 18083) |
    | mqtt_broker   | TCP socket open to port 1883                        |
    | thingsboard   | Sysadmin login — confirms TB is up + creds valid    |
    | headscale     | `GET /health` REST endpoint                         |
    | rabbitmq      | Active aio-pika connection check                    |

    Returns `"overall": "ok"` when every probe passes, `"degraded"` otherwise.
    Individual service errors do NOT return HTTP 4xx/5xx — they appear as
    `"status": "error"` in the JSON body so the caller can see which specific
    service is down.
    """
    return await connectivity.run_all()
