from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class PaymentCreateRequest(BaseModel):
    category: str  # rent | deposit | utility_deposit | utility | late_fee | termination_fee
    method: str    # manual | cash | bank_transfer | mpesa_stk | mpesa_b2c
    amount: float = Field(gt=0)
    payment_date: date
    mpesa_phone: Optional[str] = None
    notes: Optional[str] = None


class RefundRequest(BaseModel):
    method: str    # mpesa_b2c | manual | bank_transfer
    mpesa_phone: Optional[str] = None
    notes: Optional[str] = None


class PaymentResponse(BaseModel):
    id: str
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    category: str
    method: str
    direction: str
    amount: float
    currency: str
    status: str
    mpesa_checkout_request_id: Optional[str] = None
    mpesa_receipt_no: Optional[str] = None
    mpesa_phone: Optional[str] = None
    notes: Optional[str] = None
    recorded_by: Optional[str] = None
    payment_date: date
    created_at: datetime
    updated_at: datetime


class PaymentSummary(BaseModel):
    payments: List[PaymentResponse]
    total_paid: float
    total_refunded: float
    balance: float
    deposit_paid: float
    deposit_required: float     # deposit + utility_deposit + prorated_rent
    prorated_rent: float        # move-in month pro-rated rent component
    prorated_days: int          # days charged (inclusive of move-in day)
    days_in_month: int          # total days in move-in month
    fully_paid: bool
    prepayment_credit: float = 0.0   # direct deposit overpayment; offsets future deposit
    outstanding_balance: float = 0.0  # sum of balance_due across unpaid invoices


class LedgerEntryResponse(BaseModel):
    id: str
    org_id: str
    lease_id: str
    property_id: str
    tenant_id: str
    payment_id: Optional[str]
    type: str
    category: str
    amount: float
    description: str
    running_balance: float
    created_at: datetime
