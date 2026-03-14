import uuid
from datetime import date, datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.models.property import PricingTier
from app.utils.datetime import utc_now


class InvoiceLineItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # type: rent | subscription_utility | metered_utility | credit | adjustment | carried_forward
    type: str
    description: str
    utility_key: Optional[str] = None
    quantity: float = 1.0
    unit_price: float           # flat rate (fallback when no tiers, or display purposes)
    amount: float               # computed: tiered or flat × quantity
    tiers: Optional[List[PricingTier]] = None  # tiered pricing snapshot (metered only)
    meter_ticket_id: Optional[str] = None  # linked Ticket id for metered utilities
    # Meter reading evidence (populated when reading is captured)
    current_reading: Optional[float] = None
    previous_reading: Optional[float] = None
    meter_image_key: Optional[str] = None  # S3 key for captured meter photo
    # status: confirmed | pending (pending = awaiting meter reading)
    status: str = "confirmed"


class Invoice(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    unit_id: str
    lease_id: str
    tenant_id: str

    # Idempotency key: f"{'sandbox:' if sandbox else ''}{lease_id}:{billing_month}"
    idempotency_key: str

    billing_month: str  # "YYYY-MM"
    # invoice_category: rent | deposit  — determines FIFO pool isolation
    invoice_category: str = "rent"
    # status: draft | ready | sent | partial_paid | paid | overdue | void
    status: str = "draft"
    sandbox: bool = False

    reference_no: str  # e.g. INV-000042
    due_date: date

    line_items: List[InvoiceLineItem] = []
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    amount_paid: float = 0.0
    balance_due: float = 0.0
    carried_forward: float = 0.0

    late_fees_applied: int = 0           # number of late fee line items applied
    late_fee_amount: float = 0.0        # cumulative late fee amount applied
    is_proforma: bool = False           # True if sent as proforma (not yet due)

    notes: Optional[str] = None
    pdf_key: Optional[str] = None       # S3 key for cached PDF (set on first successful generation)
    sent_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None

    created_by: Optional[str] = None  # user_id or "system"
    smart_meter_summary: Optional[dict] = None   # populated by apply-smart-meter endpoint
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "invoices"
        indexes = [
            IndexModel([("idempotency_key", ASCENDING)], unique=True),
            IndexModel(
                [
                    ("org_id", ASCENDING),
                    ("status", ASCENDING),
                    ("billing_month", ASCENDING),
                ]
            ),
            IndexModel([("org_id", ASCENDING), ("tenant_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("lease_id", ASCENDING)]),
            IndexModel(
                [("org_id", ASCENDING), ("property_id", ASCENDING), ("billing_month", ASCENDING)]
            ),
        ]

class BillingCycleRun(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    billing_month: str

    # run_type: auto | manual | dry_run | sandbox
    run_type: str
    sandbox: bool = False
    triggered_by: Optional[str] = None  # user_id or "scheduler"

    # status: running | completed | failed | partial
    status: str = "running"
    invoices_created: int = 0
    invoices_skipped: int = 0
    invoices_failed: int = 0

    dry_run_preview: Optional[List[dict]] = None
    failures: List[dict] = []
    meter_ticket_ids: List[str] = []

    started_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "billing_cycle_runs"
        indexes = [
            IndexModel(
                [
                    ("org_id", ASCENDING),
                    ("billing_month", ASCENDING),
                    ("created_at", DESCENDING),
                ]
            ),
        ]


class VacantUnitDetail(BaseModel):
    property_id: str
    property_name: str
    unit_id: str
    unit_label: str
    days_vacant: int
    estimated_rent: Optional[float] = None
    estimated_lost_rent: Optional[float] = None


class VacancyReport(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    billing_month: str
    billing_cycle_run_id: str

    total_units: int
    occupied_units: int
    vacant_units: int
    vacancy_rate: float  # 0.0 – 1.0

    vacant_details: List[VacantUnitDetail] = []
    estimated_lost_rent: float = 0.0

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "vacancy_reports"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("billing_month", ASCENDING)]),
        ]
