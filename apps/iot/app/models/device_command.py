import uuid
from typing import Any, Dict, Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class DeviceCommand(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    device_id: str                      # Device._id as string

    # Command
    command_name: str                   # e.g. "set_lock_state", "reboot", "get_config"
    params: Dict[str, Any] = {}

    # RPC correlation — published to device topic, matched on response
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))

    # Lifecycle
    status: str = "pending"            # pending|sent|acknowledged|success|failed|timeout
    response: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    # Audit
    sent_by_user_id: str
    sent_via: str = "api"              # api|scheduler|automation

    # Timing
    sent_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    timeout_at: Optional[datetime] = None

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_commands"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("device_id", ASCENDING), ("created_at", ASCENDING)]),
            IndexModel([("request_id", ASCENDING)], unique=True),
            IndexModel([("status", ASCENDING), ("timeout_at", ASCENDING)]),
        ]
