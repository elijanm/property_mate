from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class ChecklistItemUpdateRequest(BaseModel):
    checked: Optional[bool] = None
    notes: Optional[str] = None


class DamageItemCreateRequest(BaseModel):
    description: str
    location: str
    severity: str = "minor"
    estimated_cost: float = Field(ge=0)
    deduct_from_deposit: bool = True


class MoveOutCreateRequest(BaseModel):
    scheduled_date: Optional[date] = None
    inspector_id: Optional[str] = None


class MoveOutApproveRequest(BaseModel):
    deposit_deduction: float = Field(ge=0)
    inspector_notes: Optional[str] = None


class ChecklistItemResponse(BaseModel):
    id: str
    label: str
    category: str
    checked: bool
    notes: Optional[str]
    photo_key: Optional[str]
    checked_by: Optional[str]
    checked_at: Optional[datetime]


class DamageItemResponse(BaseModel):
    id: str
    description: str
    location: str
    severity: str
    estimated_cost: float
    photo_keys: List[str]
    deduct_from_deposit: bool
    assessed_by: Optional[str]
    assessed_at: Optional[datetime]


class MoveOutInspectionResponse(BaseModel):
    id: str
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    status: str
    scheduled_date: Optional[date]
    completed_date: Optional[date]
    inspector_id: Optional[str]
    checklist: List[ChecklistItemResponse]
    damages: List[DamageItemResponse]
    total_damage_cost: float
    deposit_deduction: float
    net_deposit_refund: float
    inspector_notes: Optional[str]
    approved_by: Optional[str]
    approved_at: Optional[datetime]
    reconciliation_pdf_key: Optional[str]
    reconciliation_pdf_url: Optional[str]
    created_at: datetime
    updated_at: datetime
