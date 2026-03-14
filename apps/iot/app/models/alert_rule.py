from typing import Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class AlertRule(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)

    # Multi-tenancy
    org_id: str
    property_id: Optional[str] = None

    # Scope — rule applies to a specific device, all devices of a type, a group, or org-wide
    device_id: Optional[str] = None        # None = apply to device_type_id or group_id
    device_type_id: Optional[str] = None
    group_id: Optional[str] = None

    # Rule definition
    name: str
    description: Optional[str] = None
    is_active: bool = True
    telemetry_key: str                     # e.g. "temperature"
    operator: str                          # gt | lt | gte | lte | eq | neq
    threshold: float

    # Alert firing behaviour
    consecutive_violations: int = 1        # number of consecutive violations before alert fires
    cooldown_m: int = 15                   # minutes to wait before firing the same alert again
    severity: str = "warning"             # info | warning | critical

    # Alert content
    alert_message_template: str = "Device {device_name}: {key} is {value} ({operator} {threshold})"

    # Actions on alert
    create_ticket: bool = True
    notify_email: bool = True

    # Audit
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "iot_alert_rules"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("is_active", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("device_type_id", ASCENDING)]),
            IndexModel([("device_id", ASCENDING)]),
            IndexModel([("deleted_at", ASCENDING)]),
        ]
