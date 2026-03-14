from typing import List, Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class DeviceOTAStatus(BaseModel):
    device_id: str
    device_uid: str
    status: str = "pending"   # pending | sent | in_progress | completed | failed
    progress_pct: int = 0
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class OTAUpdate(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)

    # Multi-tenancy
    org_id: str

    # Target scope
    device_type_id: str
    device_ids: List[str] = []       # explicit list; empty = all devices of this type in org
    group_id: Optional[str] = None

    # Firmware artifact
    target_version: str
    firmware_s3_key: str
    firmware_size_bytes: Optional[int] = None
    checksum_sha256: Optional[str] = None
    release_notes: Optional[str] = None

    # Rollout control
    rollout_pct: int = 100           # percentage of target devices to update (0-100)
    status: str = "draft"            # draft | active | paused | completed | cancelled

    # Per-device progress tracking
    device_statuses: List[DeviceOTAStatus] = []

    # Audit
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "iot_ota_updates"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("device_type_id", ASCENDING)]),
            IndexModel([("deleted_at", ASCENDING)]),
        ]
