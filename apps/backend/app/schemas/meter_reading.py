from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class MeterReadingCreateRequest(BaseModel):
    unit_id: Optional[str] = None    # None for property-level master meter readings
    utility_key: str
    current_reading: float = Field(ge=0)
    read_at: Optional[datetime] = None   # defaults to server UTC now
    notes: Optional[str] = None
    source: str = "manual"               # "manual" | "iot"


class MeterReadingResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_id: Optional[str]
    utility_key: str
    previous_reading: Optional[float]
    current_reading: float
    units_consumed: Optional[float]
    read_at: datetime
    read_by: str
    read_by_name: Optional[str] = None   # resolved display name of the user who recorded
    source: str
    notes: Optional[str]
    created_at: datetime


class MeterReadingListResponse(BaseModel):
    items: List[MeterReadingResponse]
    total: int
    page: int
    page_size: int
