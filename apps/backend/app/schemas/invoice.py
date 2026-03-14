from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class TierBandResponse(BaseModel):
    band: str
    units: float
    rate: float
    subtotal: float


class InvoiceLineItemResponse(BaseModel):
    id: str
    type: str
    description: str
    utility_key: Optional[str] = None
    quantity: float
    unit_price: float
    amount: float
    meter_ticket_id: Optional[str] = None
    current_reading: Optional[float] = None
    previous_reading: Optional[float] = None
    meter_image_url: Optional[str] = None  # presigned URL
    status: str
    tier_breakdown: Optional[List["TierBandResponse"]] = None


class InvoiceResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_id: str
    lease_id: str
    tenant_id: str
    idempotency_key: str
    billing_month: str
    invoice_category: str = "rent"
    status: str
    sandbox: bool
    reference_no: str
    due_date: date
    line_items: List[InvoiceLineItemResponse] = []
    subtotal: float
    tax_amount: float
    total_amount: float
    amount_paid: float
    balance_due: float
    carried_forward: float
    notes: Optional[str] = None
    sent_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    smart_meter_summary: Optional[Dict[str, Any]] = None

    # Enriched fields
    tenant_name: Optional[str] = None
    property_name: Optional[str] = None
    unit_label: Optional[str] = None


class InvoiceListResponse(BaseModel):
    items: List[InvoiceResponse]
    total: int
    page: int
    page_size: int


class InvoiceCountsResponse(BaseModel):
    draft: int = 0
    ready: int = 0
    sent: int = 0
    partial_paid: int = 0
    paid: int = 0
    overdue: int = 0
    void: int = 0
    total: int = 0


class InvoiceGenerateRequest(BaseModel):
    billing_month: str          # "YYYY-MM"
    sandbox: bool = False
    dry_run: bool = False


class InvoiceUpdateRequest(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[date] = None


class InvoicePaymentRequest(BaseModel):
    amount: float
    method: str                 # cash | bank_transfer | mpesa_stk | manual
    payment_date: date
    reference: Optional[str] = None
    notes: Optional[str] = None


class BillingCycleRunResponse(BaseModel):
    id: str
    org_id: str
    billing_month: str
    run_type: str
    sandbox: bool
    triggered_by: Optional[str] = None
    status: str
    invoices_created: int
    invoices_skipped: int
    invoices_failed: int
    dry_run_preview: Optional[List[Dict[str, Any]]] = None
    failures: List[dict] = []
    started_at: datetime
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class BillingCycleRunListResponse(BaseModel):
    items: List[BillingCycleRunResponse]
    total: int
    page: int
    page_size: int


class BillingRunTriggerResponse(BaseModel):
    """Returned by POST /invoices/generate when dry_run=False (async path)."""
    job_id: str
    status: str          # "queued"
    billing_month: str
