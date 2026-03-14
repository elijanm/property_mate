from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# ── Discount schemas ──────────────────────────────────────────────────────────

class LeaseDiscountCreateRequest(BaseModel):
    label: str
    type: str  # "fixed" | "percentage"
    value: float = Field(gt=0)
    effective_from: date
    effective_to: Optional[date] = None
    note: Optional[str] = None


class LeaseDiscountResponse(BaseModel):
    id: str
    label: str
    type: str
    value: float
    effective_from: date
    effective_to: Optional[date] = None
    note: Optional[str] = None
    recorded_by: str
    created_at: datetime
    # computed fields
    effective_rent: float   # rent after this discount applied
    discount_amount: float  # KES saving


# ── Escalation schemas ────────────────────────────────────────────────────────

class RentEscalationCreateRequest(BaseModel):
    effective_date: date
    new_rent_amount: float = Field(gt=0)
    note: Optional[str] = None


class RentEscalationResponse(BaseModel):
    id: str
    effective_date: date
    new_rent_amount: float
    percentage_increase: Optional[float]
    applied: bool
    applied_at: Optional[datetime]
    note: Optional[str]
    created_by: str
    created_at: datetime


# ── Early termination schemas ─────────────────────────────────────────────────

class EarlyTerminationTermsRequest(BaseModel):
    penalty_type: str = "months"
    penalty_value: float = Field(gt=0)
    notice_days: int = Field(ge=0, default=30)
    note: Optional[str] = None


class EarlyTerminationTermsResponse(BaseModel):
    penalty_type: str
    penalty_value: float
    notice_days: int
    note: Optional[str]
    penalty_amount: float  # computed: months*rent or fixed


# ── Renewal offer schemas ─────────────────────────────────────────────────────

class RenewalOfferCreateRequest(BaseModel):
    new_rent_amount: float = Field(gt=0)
    new_end_date: Optional[date] = None
    message: Optional[str] = None


class RenewalOfferResponse(BaseModel):
    id: str
    new_rent_amount: float
    new_end_date: Optional[date]
    message: Optional[str]
    status: str
    sent_at: datetime
    responded_at: Optional[datetime]
    created_by: str


# ── Co-tenant / guarantor schemas ─────────────────────────────────────────────

class CoTenantCreateRequest(BaseModel):
    role: str = "co_tenant"
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None


class CoTenantResponse(BaseModel):
    id: str
    role: str
    first_name: str
    last_name: str
    email: Optional[str]
    phone: Optional[str]
    id_type: Optional[str]
    id_number: Optional[str]
    added_at: datetime
    added_by: str


# ── Notes & rating schemas ────────────────────────────────────────────────────

class LeaseNoteCreateRequest(BaseModel):
    body: str
    is_private: bool = True


class LeaseNoteResponse(BaseModel):
    id: str
    body: str
    is_private: bool
    created_by: str
    created_at: datetime


class TenantRatingRequest(BaseModel):
    score: int = Field(ge=1, le=5)
    payment_timeliness: int = Field(ge=1, le=5, default=3)
    property_care: int = Field(ge=1, le=5, default=3)
    communication: int = Field(ge=1, le=5, default=3)
    note: Optional[str] = None


class TenantRatingResponse(BaseModel):
    score: int
    payment_timeliness: int
    property_care: int
    communication: int
    note: Optional[str]
    rated_by: str
    rated_at: datetime


# ── Inline tenant creation ────────────────────────────────────────────────────

class TenantCreateInline(BaseModel):
    """Create a new tenant account atomically when creating a lease."""
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    password: str = Field(min_length=8)


# ── Lease CRUD ────────────────────────────────────────────────────────────────

class LeaseCreateRequest(BaseModel):
    unit_id: str
    # provide either tenant_id (existing) or tenant_create (new)
    tenant_id: Optional[str] = None
    tenant_create: Optional[TenantCreateInline] = None
    onboarding_id: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None
    rent_amount: float = Field(gt=0)
    deposit_amount: float = Field(ge=0)
    utility_deposit: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class LeaseResponse(BaseModel):
    id: str
    reference_no: str
    org_id: str
    property_id: str
    unit_id: str
    unit_code: Optional[str] = None           # denormalised from Unit
    tenant_id: str
    onboarding_id: Optional[str]
    onboarding_token: Optional[str] = None    # present only on create; used to redirect to /onboarding/<token>
    status: str
    start_date: date
    end_date: Optional[date]
    rent_amount: float
    deposit_amount: float
    utility_deposit: Optional[float]
    unit_utility_deposits: float = 0.0        # sum of utility_overrides[*].deposit
    notes: Optional[str]
    signed_at: Optional[datetime]
    activated_at: Optional[datetime]
    terminated_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    discounts: List[LeaseDiscountResponse] = []
    effective_rent: float = 0.0               # rent after active discounts
    discount_amount: float = 0.0              # total KES discount currently active
    escalations: List[RentEscalationResponse] = []
    early_termination: Optional[EarlyTerminationTermsResponse] = None
    renewal_offer: Optional[RenewalOfferResponse] = None
    co_tenants: List[CoTenantResponse] = []
    notes_internal: List[LeaseNoteResponse] = []
    rating: Optional[TenantRatingResponse] = None


class LeaseListResponse(BaseModel):
    items: List[LeaseResponse]
    total: int
    page: int
    page_size: int


# ── Unit pricing breakdown ────────────────────────────────────────────────────

class UtilityLineItem(BaseModel):
    key: str
    label: str
    type: str                   # shared | metered | subscription
    rate: Optional[float]
    unit_label: Optional[str]   # e.g. KWh, m³, KES/mo
    income_account: Optional[str]
    deposit: Optional[float] = None  # per-utility one-time deposit


class UnitPricingResponse(BaseModel):
    unit_id: str
    unit_code: str
    rent_amount: float
    deposit_amount: float
    deposit_rule: str
    utility_deposit: Optional[float]
    utilities: List[UtilityLineItem]
    prorated_rent: float            # rent for remaining days of move-in month
    prorated_days: int              # number of days charged
    days_in_month: int              # total days in move-in month
    total_move_in: float            # deposit + utility_deposit + prorated_rent
