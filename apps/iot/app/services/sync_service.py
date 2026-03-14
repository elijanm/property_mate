"""
IoT Sync Service — provisions the full hierarchy in ThingsBoard and registers
devices across all IoT systems in a single coordinated call.

Hierarchy:
  PMS Org      → ThingsBoard Tenant
  PMS Property → ThingsBoard Customer  (under the TB Tenant)
  PMS Unit     → ThingsBoard Asset     (under the TB Customer)
  PMS Device   → ThingsBoard Device    (under the TB Customer)
               → MongoDB Device doc    (with bcrypt MQTT credentials)
               → EMQX: credentials enforced at connect via HTTP hook

This service is idempotent: calling it twice with the same IDs returns the
same result without creating duplicates in ThingsBoard.
"""
import uuid
import asyncio
import hashlib
from datetime import timedelta
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
import bcrypt as _bcrypt_lib
from pymongo.errors import DuplicateKeyError as _MongoDupKey

from app.models.device import Device, DeviceConfig
from app.models.device_type import DeviceType
from app.services import thingsboard_client, headscale_client
from app.services import ca_service
from app.core.redis import get_redis
from app.core.logging import get_logger
from app.core.config import settings
from app.core.exceptions import ConflictError, ResourceNotFoundError, ThingsBoardError
from app.utils.datetime import utc_now
from beanie import PydanticObjectId

logger = get_logger(__name__)
def _hash_pw(pw: str) -> str:
    return _bcrypt_lib.hashpw(pw.encode(), _bcrypt_lib.gensalt(rounds=12)).decode()



# ── Result dataclasses ──────────────────────────────────────────────────────

@dataclass
class SyncStep:
    name: str
    status: str          # "ok" | "skipped" | "error"
    detail: str = ""
    external_id: str = ""


@dataclass
class DeviceRegistrationResult:
    device_id: str
    device_uid: str
    org_id: str
    property_id: str
    unit_id: Optional[str]

    # MQTT — password shown once only
    mqtt_username: str
    mqtt_password: str
    mqtt_client_id: str

    # mTLS / X.509 — cert and key shown once only (None when CA is unavailable)
    device_cert_pem: Optional[str]    # PEM-encoded client certificate
    device_key_pem: Optional[str]     # PEM-encoded private key (shown once — store securely)
    cert_fingerprint: Optional[str]   # SHA-256 fingerprint for identification / revocation
    cert_expires_at: Optional[str]    # ISO-8601 expiry timestamp

    # ThingsBoard
    tb_device_id: Optional[str]
    tb_access_token: Optional[str]
    tb_tenant_id: Optional[str]
    tb_customer_id: Optional[str]
    tb_asset_id: Optional[str]

    # Provisioning audit trail
    steps: List[SyncStep] = field(default_factory=list)
    status: str = "provisioned"  # "provisioned" | "partial" (TB unreachable)


# ── Core provisioning logic ─────────────────────────────────────────────────

async def provision_org_tenant(org_id: str, org_name: str) -> SyncStep:
    """Ensure a TB Tenant exists for this PMS Org. Idempotent."""
    redis = get_redis()
    cached = await redis.get(f"{org_id}:iot:tb:tenant_id")
    if cached:
        return SyncStep("provision_org_tenant", "skipped",
                        "TB tenant already exists", cached)
    try:
        tb_tenant_id = await thingsboard_client.get_or_create_tenant(org_id, org_name)
        return SyncStep("provision_org_tenant", "ok",
                        f"TB tenant ready: {tb_tenant_id}", tb_tenant_id)
    except Exception as e:
        logger.error("sync_provision_org_tenant_failed", org_id=org_id, error=str(e))
        return SyncStep("provision_org_tenant", "error", str(e))


async def provision_property_customer(
    org_id: str, property_id: str, property_name: str
) -> SyncStep:
    """Ensure a TB Customer exists for this PMS Property. Idempotent."""
    redis = get_redis()
    cached = await redis.get(f"{org_id}:iot:tb:customer:{property_id}")
    if cached:
        return SyncStep("provision_property_customer", "skipped",
                        "TB customer already exists", cached)
    try:
        customer_id = await thingsboard_client.get_or_create_customer(
            org_id, property_id, property_name
        )
        return SyncStep("provision_property_customer", "ok",
                        f"TB customer ready: {customer_id}", customer_id)
    except Exception as e:
        logger.error("sync_provision_property_customer_failed",
                     org_id=org_id, property_id=property_id, error=str(e))
        return SyncStep("provision_property_customer", "error", str(e))


async def provision_unit_asset(
    org_id: str, customer_id: str, unit_id: str, unit_name: str
) -> SyncStep:
    """Ensure a TB Asset exists for this PMS Unit. Idempotent."""
    redis = get_redis()
    cached = await redis.get(f"{org_id}:iot:tb:asset:{unit_id}")
    if cached:
        return SyncStep("provision_unit_asset", "skipped",
                        "TB asset already exists", cached)
    try:
        tb_asset_id = await thingsboard_client.get_or_create_asset(
            org_id, customer_id, unit_id, unit_name, asset_type="unit"
        )
        return SyncStep("provision_unit_asset", "ok",
                        f"TB asset ready: {tb_asset_id}", tb_asset_id)
    except Exception as e:
        logger.error("sync_provision_unit_asset_failed",
                     org_id=org_id, unit_id=unit_id, error=str(e))
        return SyncStep("provision_unit_asset", "error", str(e))


async def register_device(
    org_id: str,
    org_name: str,
    property_id: str,
    property_name: str,
    device_uid: str,
    device_name: str,
    device_type_id: str,
    unit_id: Optional[str] = None,
    unit_name: Optional[str] = None,
    store_location_id: Optional[str] = None,
    gateway_id: Optional[str] = None,
    description: Optional[str] = None,
    serial_number: Optional[str] = None,
    tags: Optional[List[str]] = None,
    capabilities: Optional[List[str]] = None,   # if None, uses device_type.capabilities
) -> DeviceRegistrationResult:
    """
    Full device provisioning:
      1. Validate uniqueness
      2. Resolve device type
      3. Provision TB hierarchy (Tenant → Customer → Asset)
      4. Create MongoDB Device with MQTT credentials
      5. Provision TB Device
      6. Return complete result with credentials and audit trail
    """
    steps: List[SyncStep] = []
    now = utc_now()

    # ── Step 1: Check uniqueness ──────────────────────────────────────────
    existing = await Device.find_one({"device_uid": device_uid, "deleted_at": None})
    if existing:
        raise ConflictError(f"device_uid '{device_uid}' is already registered")

    # ── Step 2: Resolve device type ───────────────────────────────────────
    device_type = await DeviceType.find_one(
        {"_id": PydanticObjectId(device_type_id), "deleted_at": None}
    )
    if not device_type:
        raise ResourceNotFoundError("DeviceType", device_type_id)
    steps.append(SyncStep("resolve_device_type", "ok",
                          f"Type: {device_type.category}", device_type_id))

    # ── Step 3: ThingsBoard hierarchy (sequential: tenant must exist before customer) ──
    # Tenant provisioning must complete first — it activates credentials that the
    # customer step needs to authenticate with.
    tenant_step = await provision_org_tenant(org_id, org_name)
    steps.append(tenant_step)

    customer_step = await provision_property_customer(org_id, property_id, property_name)
    steps.append(customer_step)

    customer_id = customer_step.external_id if customer_step.status != "error" else None
    tb_asset_id = None

    if unit_id and customer_id:
        asset_step = await provision_unit_asset(
            org_id, customer_id, unit_id, unit_name or unit_id
        )
        steps.append(asset_step)
        tb_asset_id = asset_step.external_id if asset_step.status != "error" else None

    # ── Step 3b: Issue mTLS client certificate (best-effort) ─────────────
    # CN format: "d:<device_uid>" — EMQX extracts this as the MQTT username
    # when peer_cert_as_username = cn is set on the TLS listener.
    device_cert_pem: Optional[str] = None
    device_key_pem: Optional[str] = None
    cert_fingerprint: Optional[str] = None
    cert_expires_at_str: Optional[str] = None

    try:
        cert_result = await ca_service.issue_device_cert(device_uid)
        device_cert_pem  = cert_result["cert_pem"]
        device_key_pem   = cert_result["key_pem"]
        cert_fingerprint = cert_result["fingerprint"]
        cert_expires_at  = cert_result["expires_at"]          # datetime
        cert_expires_at_str = cert_expires_at.isoformat()
        steps.append(SyncStep("issue_mtls_cert", "ok",
                               f"Client cert issued; expires {cert_expires_at_str}",
                               cert_fingerprint))
    except Exception as e:
        logger.warning("sync_issue_cert_failed", device_uid=device_uid, error=str(e))
        steps.append(SyncStep("issue_mtls_cert", "error",
                               f"CA unavailable — password auth still works: {e}"))

    # ── Step 4: Create Device in MongoDB with MQTT credentials ────────────
    raw_password = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    password_hash = _hash_pw(raw_password)

    device = Device(
        org_id=org_id,
        property_id=property_id,
        unit_id=unit_id,
        store_location_id=store_location_id,
        gateway_id=gateway_id,
        device_type_id=device_type_id,
        device_type_category=device_type.category,
        device_uid=device_uid,
        name=device_name,
        description=description,
        serial_number=serial_number,
        tags=tags or [],
        mqtt_username=device_uid,
        mqtt_password_hash=password_hash,
        mqtt_client_id=f"d:{device_uid}",
        capabilities=capabilities if capabilities is not None else device_type.capabilities,
        cert_fingerprint=cert_fingerprint,
        cert_expires_at=cert_expires_at if cert_fingerprint else None,
        cert_issued_at=now if cert_fingerprint else None,
        created_at=now,
        updated_at=now,
    )
    try:
        await device.insert()
    except _MongoDupKey as exc:
        # Unique index violated — surface as a clean ConflictError
        raise ConflictError(
            f"device_uid '{device_uid}' is already registered "
            f"(possibly a soft-deleted record still holds the unique key — "
            f"drop index or hard-delete the old document). Detail: {exc}"
        ) from exc
    steps.append(SyncStep("create_device_db", "ok",
                          f"MongoDB device created: {device.id}", str(device.id)))

    # ── Step 5: Provision Device in ThingsBoard ────────────────────────────
    tb_device_id = None
    tb_access_token = None
    tb_tenant_id = None

    redis = get_redis()
    tb_tenant_id = await redis.get(f"{org_id}:iot:tb:tenant_id")

    if customer_id:
        try:
            tb_data = await thingsboard_client.provision_device(
                org_id=org_id,
                customer_id=customer_id,
                device_uid=device_uid,
                device_name=device_name,
                device_type=device_type.category,
            )
            tb_device_id = tb_data["tb_device_id"]
            tb_access_token = tb_data["tb_access_token"]

            await device.set({
                "tb_device_id": tb_device_id,
                "tb_access_token": tb_access_token,
                "tb_customer_id": customer_id,
                "updated_at": utc_now(),
            })
            steps.append(SyncStep("provision_tb_device", "ok",
                                  f"TB device ready: {tb_device_id}", tb_device_id))
        except Exception as e:
            logger.warning("sync_tb_device_provision_failed",
                           device_uid=device_uid, error=str(e))
            steps.append(SyncStep("provision_tb_device", "error", str(e)))

    has_error = any(s.status == "error" for s in steps)
    final_status = "partial" if has_error else "provisioned"

    logger.info(
        "device_registered",
        action="register_device",
        org_id=org_id,
        device_uid=device_uid,
        device_id=str(device.id),
        tb_device_id=tb_device_id,
        status=final_status,
    )

    return DeviceRegistrationResult(
        device_id=str(device.id),
        device_uid=device_uid,
        org_id=org_id,
        property_id=property_id,
        unit_id=unit_id,
        mqtt_username=device_uid,
        mqtt_password=raw_password,
        mqtt_client_id=f"d:{device_uid}",
        device_cert_pem=device_cert_pem,
        device_key_pem=device_key_pem,
        cert_fingerprint=cert_fingerprint,
        cert_expires_at=cert_expires_at_str,
        tb_device_id=tb_device_id,
        tb_access_token=tb_access_token,
        tb_tenant_id=tb_tenant_id,
        tb_customer_id=customer_id,
        tb_asset_id=tb_asset_id,
        steps=steps,
        status=final_status,
    )
