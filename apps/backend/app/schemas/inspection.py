from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class InspectionCreateRequest(BaseModel):
    type: str  # pre_move_in | move_out
    notes: Optional[str] = None


class MeterReadingRequest(BaseModel):
    utility_key: str
    utility_label: str
    reading: float
    unit_label: str


class DefectRequest(BaseModel):
    location: str
    description: str


class MeterReadingItemResponse(BaseModel):
    utility_key: str
    utility_label: str
    reading: float
    unit_label: str
    photo_url: Optional[str] = None  # presigned S3 URL


class DefectItemResponse(BaseModel):
    id: str
    location: str
    description: str
    photo_urls: List[str] = []  # presigned S3 URLs


class InspectionResponse(BaseModel):
    id: str
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    type: str
    status: str
    token: str
    meter_readings: List[MeterReadingItemResponse] = []
    defects: List[DefectItemResponse] = []
    official_meter_readings: List[MeterReadingItemResponse] = []
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class InspectionPublicResponse(BaseModel):
    """Returned on public token-based endpoints — token field is omitted."""
    id: str
    lease_id: str
    type: str
    status: str
    meter_readings: List[MeterReadingItemResponse] = []
    defects: List[DefectItemResponse] = []
    expires_at: Optional[datetime] = None
    window_days: int = 15
    submitted_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
