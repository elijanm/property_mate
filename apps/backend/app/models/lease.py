import random
import string
import uuid
from datetime import date, datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


def _generate_ref() -> str:
    """Short human-readable lease reference, e.g. LSE-K7XM2P"""
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"LSE-{suffix}"


class LeaseDiscount(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str                         # e.g. "Manager special", "Loyalty discount"
    type: str                          # "fixed" | "percentage"
    value: float                       # KES amount OR percentage (0-100)
    effective_from: date
    effective_to: Optional[date] = None   # None = ongoing
    recorded_by: str
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class RentEscalation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    effective_date: date
    new_rent_amount: float
    percentage_increase: Optional[float] = None
    applied: bool = False
    applied_at: Optional[datetime] = None
    note: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)


class EarlyTerminationTerms(BaseModel):
    penalty_type: str = "months"   # "months" | "fixed"
    penalty_value: float = 2.0
    notice_days: int = 30
    note: Optional[str] = None


class RenewalOffer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    new_rent_amount: float
    new_end_date: Optional[date] = None
    message: Optional[str] = None
    status: str = "pending"    # pending | accepted | declined | expired
    sent_at: datetime = Field(default_factory=utc_now)
    responded_at: Optional[datetime] = None
    created_by: str


class CoTenant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str = "co_tenant"      # co_tenant | guarantor
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    added_at: datetime = Field(default_factory=utc_now)
    added_by: str


class LeaseNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    body: str
    is_private: bool = True
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)


class TenantRating(BaseModel):
    score: int = Field(ge=1, le=5)
    payment_timeliness: int = Field(ge=1, le=5, default=3)
    property_care: int = Field(ge=1, le=5, default=3)
    communication: int = Field(ge=1, le=5, default=3)
    note: Optional[str] = None
    rated_by: str
    rated_at: datetime = Field(default_factory=utc_now)


class Lease(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    reference_no: str = Field(default_factory=_generate_ref)
    org_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    onboarding_id: Optional[str] = None
    # draft → pending_payment → pending_signature → active | expired | terminated
    status: str = "draft"
    start_date: date
    end_date: Optional[date] = None
    rent_amount: float
    deposit_amount: float
    utility_deposit: Optional[float] = None
    notes: Optional[str] = None
    signed_at: Optional[datetime] = None
    activated_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None
    terminated_by: Optional[str] = None  # user_id
    discounts: List[LeaseDiscount] = []
    escalations: List[RentEscalation] = []
    early_termination: Optional[EarlyTerminationTerms] = None
    renewal_offer: Optional[RenewalOffer] = None
    co_tenants: List[CoTenant] = []
    notes_internal: List[LeaseNote] = []
    rating: Optional[TenantRating] = None
    # Smart reminder tracking — prevents email spam
    last_reminder_sent_at: Optional[datetime] = None
    reminder_count: int = 0
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "leases"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("unit_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("tenant_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
        ]
