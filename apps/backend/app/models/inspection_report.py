import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class MeterReadingItem(BaseModel):
    utility_key: str
    utility_label: str
    reading: float
    unit_label: str
    photo_key: Optional[str] = None  # S3 key


class DefectItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    location: str
    description: str
    photo_keys: List[str] = []


class InspectionReport(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    # type: pre_move_in | move_out
    type: str
    # status: pending | submitted | reviewed
    status: str = "pending"
    token: str  # secrets.token_urlsafe(32) for public access
    meter_readings: List[MeterReadingItem] = []
    defects: List[DefectItem] = []
    # Official readings adopted after ticket resolution; empty = submitted readings are authoritative
    official_meter_readings: List[MeterReadingItem] = []
    expires_at: Optional[datetime] = None  # self-inspection window end
    window_days: int = 15  # how many days the window lasts
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None  # user_id
    notes: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "inspection_reports"
        indexes = [
            IndexModel(
                [("org_id", ASCENDING), ("lease_id", ASCENDING), ("type", ASCENDING)]
            ),
            IndexModel([("token", ASCENDING)], unique=True),
        ]
