import uuid
from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class MeterReading(Document):
    """
    Audit log of meter readings for metered utilities.

    utility_key is one of:
      "electricity" | "water" | "gas" | "internet" | "garbage" | "security"
      or a custom utility key set on the property (e.g. "gym_membership").
    """
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    unit_id: Optional[str] = None   # None = property-level master meter reading
    utility_key: str
    previous_reading: Optional[float] = None   # last recorded value (None on first read)
    current_reading: float
    units_consumed: Optional[float] = None     # current - previous when both are known
    read_at: datetime = Field(default_factory=utc_now)
    read_by: str                               # user_id who recorded this
    source: str = "manual"                     # "manual" | "iot"
    notes: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "meter_readings"
        indexes = [
            # primary query: readings for a unit+utility ordered by time
            IndexModel(
                [
                    ("org_id", ASCENDING),
                    ("unit_id", ASCENDING),
                    ("utility_key", ASCENDING),
                    ("read_at", ASCENDING),
                ]
            ),
            # property-level queries (billing sweep)
            IndexModel(
                [
                    ("org_id", ASCENDING),
                    ("property_id", ASCENDING),
                    ("read_at", ASCENDING),
                ]
            ),
        ]
