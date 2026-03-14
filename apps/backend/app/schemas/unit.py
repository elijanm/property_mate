from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.unit import UtilityOverride


# ── Update ────────────────────────────────────────────────────────────────────

class UnitUpdateRequest(BaseModel):
    rent_base: Optional[float] = Field(default=None, ge=0)
    deposit_amount: Optional[float] = Field(default=None, ge=0)
    deposit_rule: Optional[str] = None
    utility_deposit: Optional[float] = Field(default=None, ge=0)
    status: Optional[str] = None  # vacant | reserved | occupied | inactive
    unit_type: Optional[str] = None
    size: Optional[float] = Field(default=None, ge=0)
    furnished: Optional[bool] = None
    is_premium: Optional[bool] = None
    utility_overrides: Optional[UtilityOverride] = None
    meter_id: Optional[str] = None
    iot_device_id: Optional[str] = None


class BulkUnitUpdate(BaseModel):
    unit_id: str
    updates: UnitUpdateRequest


class BulkUpdateRequest(BaseModel):
    updates: List[BulkUnitUpdate] = Field(min_length=1, max_length=500)


class BulkUpdateResponse(BaseModel):
    updated: int
    failed: int
    errors: List[Dict[str, Any]] = []


# ── Response ──────────────────────────────────────────────────────────────────

class UnitResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_code: str
    wing: Optional[str]
    floor: int
    unit_number: str
    unit_type: str
    size: Optional[float]
    furnished: bool
    is_premium: bool
    status: str
    rent_base: Optional[float]
    deposit_amount: Optional[float]
    deposit_rule: Optional[str]
    utility_deposit: Optional[float]
    utility_overrides: Optional[UtilityOverride]
    meter_id: Optional[str]
    iot_device_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class UnitListResponse(BaseModel):
    items: List[UnitResponse]
    total: int
    page: int
    page_size: int


# ── Reserve ───────────────────────────────────────────────────────────────────

class UnitReserveRequest(BaseModel):
    tenant_id: str
    onboarding_id: Optional[str] = None
