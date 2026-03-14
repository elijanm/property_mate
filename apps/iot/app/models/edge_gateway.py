from typing import List, Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class EdgeGateway(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str

    gateway_uid: str                    # unique identifier used in MQTT gw/ topics
    name: str
    description: Optional[str] = None
    model: Optional[str] = None         # e.g. "Raspberry Pi 4B", "Advantech EKI-1000"
    serial_number: Optional[str] = None

    # MQTT credentials
    mqtt_username: str                  # = gateway_uid
    mqtt_password_hash: str
    mqtt_client_id: str                 # f"gw:{gateway_uid}"

    # Tailscale / Headscale — gateways are always Tailscale nodes
    tailscale_node_id: Optional[str] = None
    tailscale_node_key: Optional[str] = None
    tailscale_ip: Optional[str] = None
    tailscale_hostname: Optional[str] = None
    tailscale_registered_at: Optional[datetime] = None
    tailscale_last_seen: Optional[datetime] = None

    # ThingsBoard gateway device
    tb_device_id: Optional[str] = None
    tb_access_token: Optional[str] = None

    # Status
    status: str = "offline"            # online|offline|provisioning|decommissioned
    last_seen_at: Optional[datetime] = None
    os_version: Optional[str] = None
    agent_version: Optional[str] = None

    # Device IDs bridged through this gateway
    bridged_device_ids: List[str] = []

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_gateways"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
            IndexModel([("gateway_uid", ASCENDING)], unique=True),
            IndexModel([("mqtt_client_id", ASCENDING)], unique=True),
            IndexModel([("tailscale_node_id", ASCENDING)], sparse=True, unique=True),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
        ]
