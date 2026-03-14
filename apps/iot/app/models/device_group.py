from typing import List, Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class DeviceGroup(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)

    # Multi-tenancy
    org_id: str
    property_id: Optional[str] = None

    # Group definition
    name: str
    description: Optional[str] = None
    tags: List[str] = []

    # Members
    device_ids: List[str] = []        # explicit device IDs
    tag_filter: Optional[str] = None  # auto-include devices with this tag

    # Audit
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "iot_device_groups"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("name", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
            IndexModel([("deleted_at", ASCENDING)]),
        ]
