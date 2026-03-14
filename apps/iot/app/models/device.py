from typing import Any, Dict, List, Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class DeviceConfig(BaseModel):
    """Per-device config overrides (layered on top of DeviceType defaults)."""
    telemetry_interval_s: int = 60
    qos: int = 1
    extra: Dict[str, Any] = {}


class Device(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)

    # Multi-tenancy
    org_id: str
    property_id: str

    # PMS entity linkages (at most one of unit_id / store_location_id)
    unit_id: Optional[str] = None
    store_location_id: Optional[str] = None

    # Gateway (None = direct EMQX connection)
    gateway_id: Optional[str] = None

    # Type
    device_type_id: str
    device_type_category: str          # denormalised for fast filter (meter|lock|sensor|...)

    # Identity
    device_uid: str                    # hardware UID / serial; globally unique
    name: str
    description: Optional[str] = None
    serial_number: Optional[str] = None
    # Inventory linkage — the physical meter device as a stock item
    inventory_item_id: Optional[str] = None       # backend InventoryItem._id
    inventory_serial_number: Optional[str] = None  # StockSerial.serial_number
    tags: List[str] = []

    # MQTT
    mqtt_username: str                 # = device_uid
    mqtt_password_hash: str            # bcrypt hash — NEVER returned in responses
    mqtt_client_id: str                # f"d:{device_uid}"

    # Capabilities (denormalised from DeviceType)
    capabilities: List[str] = []      # telemetry|rpc|ota|ssh|attributes|streaming

    # ThingsBoard
    tb_device_id: Optional[str] = None
    tb_access_token: Optional[str] = None
    tb_customer_id: Optional[str] = None   # ThingsBoard Customer = PMS Property

    # mTLS / X.509
    cert_fingerprint: Optional[str] = None   # SHA-256 fingerprint of issued client cert
    cert_serial: Optional[str] = None        # cert serial number (for CRL revocation)
    cert_issued_at: Optional[datetime] = None
    cert_expires_at: Optional[datetime] = None

    # Headscale / Tailscale
    tailscale_node_id: Optional[str] = None
    tailscale_node_key: Optional[str] = None
    tailscale_ip: Optional[str] = None
    tailscale_hostname: Optional[str] = None   # node name in Headscale (== device_uid typically)

    # Status
    status: str = "provisioned"        # provisioned|online|offline|decommissioned|quarantined
    last_seen_at: Optional[datetime] = None
    last_telemetry_at: Optional[datetime] = None

    # Quarantine
    quarantine_reason: Optional[str] = None
    quarantined_at: Optional[datetime] = None
    quarantined_by: Optional[str] = None
    quarantine_acl_comment: Optional[str] = None

    # Firmware / OTA
    firmware_version: Optional[str] = None
    ota_pending_version: Optional[str] = None

    # Per-device config
    config: DeviceConfig = Field(default_factory=DeviceConfig)

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_devices"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("unit_id", ASCENDING)], sparse=True),
            # Partial unique indexes — only enforce uniqueness for live (non-deleted) docs
            # so a decommissioned device's UID can be re-registered.
            # NOTE: if these indexes already exist without partialFilterExpression, drop them first:
            #   db.iot_devices.dropIndex("device_uid_1")
            #   db.iot_devices.dropIndex("mqtt_username_1")
            #   db.iot_devices.dropIndex("mqtt_client_id_1")
            IndexModel(
                [("device_uid", ASCENDING)], unique=True,
                partialFilterExpression={"deleted_at": {"$eq": None}},
            ),
            IndexModel(
                [("mqtt_username", ASCENDING)], unique=True,
                partialFilterExpression={"deleted_at": {"$eq": None}},
            ),
            IndexModel(
                [("mqtt_client_id", ASCENDING)], unique=True,
                partialFilterExpression={"deleted_at": {"$eq": None}},
            ),
            IndexModel([("tb_device_id", ASCENDING)], sparse=True),
            IndexModel([("cert_fingerprint", ASCENDING)], sparse=True),
            IndexModel([("tailscale_node_id", ASCENDING)], sparse=True),
            IndexModel([("gateway_id", ASCENDING)], sparse=True),
        ]
