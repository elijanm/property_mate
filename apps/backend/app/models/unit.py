import uuid
from datetime import datetime
from typing import Dict, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.models.property import UtilityDetail
from app.utils.datetime import utc_now


class UtilityOverride(BaseModel):
    electricity: Optional[UtilityDetail] = None
    water: Optional[UtilityDetail] = None
    gas: Optional[UtilityDetail] = None
    internet: Optional[UtilityDetail] = None
    garbage: Optional[UtilityDetail] = None
    security: Optional[UtilityDetail] = None


class MeterReadingCacheEntry(BaseModel):
    """Latest meter reading for one utility key — kept in sync with meter_readings collection."""
    value: float
    read_at: datetime
    read_by: str            # user_id who recorded it
    read_by_name: str = ""  # resolved display name


class Unit(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    unit_code: str  # Deterministic: A-0102 (wing-floorunit)
    wing: Optional[str] = None
    floor: int
    unit_number: str
    unit_type: str = "standard"
    size: Optional[float] = None  # sq metres
    furnished: bool = False
    is_premium: bool = False
    status: str = "vacant"  # vacant | reserved | booked | occupied | inactive
    rent_base: Optional[float] = None
    deposit_amount: Optional[float] = None
    deposit_rule: Optional[str] = None
    utility_deposit: Optional[float] = None  # unit-level override; falls back to property default
    utility_overrides: Optional[UtilityOverride] = None
    meter_reading_cache: Dict[str, MeterReadingCacheEntry] = Field(default_factory=dict)
    meter_number: Optional[str] = None  # e.g. MTR-A0101; default MTR-<unit_code> if None
    meter_id: Optional[str] = None
    iot_device_id: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "units"
        indexes = [
            IndexModel(
                [("org_id", ASCENDING), ("property_id", ASCENDING), ("unit_code", ASCENDING)],
                unique=True,
                partialFilterExpression={"deleted_at": None},
            ),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("floor", ASCENDING)]),
        ]
