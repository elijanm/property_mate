import uuid
from datetime import date, datetime
from typing import Optional, List
from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class ChecklistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str                          # e.g. "Keys returned", "Meter reading taken"
    category: str = "general"           # general | cleaning | maintenance | utilities
    checked: bool = False
    notes: Optional[str] = None
    photo_key: Optional[str] = None     # S3 key for photo evidence
    checked_by: Optional[str] = None
    checked_at: Optional[datetime] = None


class DamageItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str
    location: str                       # e.g. "Living room wall", "Bathroom tiles"
    severity: str = "minor"            # minor | moderate | major
    estimated_cost: float = 0.0
    photo_keys: List[str] = []          # S3 keys
    deduct_from_deposit: bool = True
    assessed_by: Optional[str] = None
    assessed_at: Optional[datetime] = None


class MoveOutInspection(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    status: str = "pending"             # pending | in_progress | completed | approved
    scheduled_date: Optional[date] = None
    completed_date: Optional[date] = None
    inspector_id: Optional[str] = None
    checklist: List[ChecklistItem] = []
    damages: List[DamageItem] = []
    total_damage_cost: float = 0.0
    deposit_deduction: float = 0.0      # approved deduction from deposit
    net_deposit_refund: float = 0.0     # deposit_amount - deposit_deduction
    inspector_notes: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    reconciliation_pdf_key: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "move_out_inspections"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("lease_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("unit_id", ASCENDING)]),
        ]


DEFAULT_CHECKLIST = [
    ChecklistItem(label="Keys returned", category="general"),
    ChecklistItem(label="Parking pass / fob returned", category="general"),
    ChecklistItem(label="Final meter readings recorded", category="utilities"),
    ChecklistItem(label="Electricity meter", category="utilities"),
    ChecklistItem(label="Water meter", category="utilities"),
    ChecklistItem(label="Unit professionally cleaned", category="cleaning"),
    ChecklistItem(label="Walls – no major marks/holes", category="maintenance"),
    ChecklistItem(label="Floors – no damage beyond normal wear", category="maintenance"),
    ChecklistItem(label="Windows intact", category="maintenance"),
    ChecklistItem(label="Appliances functional", category="maintenance"),
    ChecklistItem(label="All fixtures intact", category="maintenance"),
]
