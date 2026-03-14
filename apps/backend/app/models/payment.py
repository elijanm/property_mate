import uuid
from datetime import date, datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class Payment(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    lease_id: str
    property_id: str
    unit_id: str
    tenant_id: str
    # category: rent | deposit | utility_deposit | utility | late_fee | termination_fee | refund
    category: str
    # method: manual | cash | bank_transfer | mpesa_stk | mpesa_b2c
    method: str
    # direction: inbound | outbound
    direction: str
    amount: float
    currency: str = "KES"
    # status: pending | completed | failed | cancelled
    status: str = "pending"
    mpesa_checkout_request_id: Optional[str] = None
    mpesa_receipt_no: Optional[str] = None
    mpesa_phone: Optional[str] = None
    invoice_id: Optional[str] = None   # set when payment is applied against an invoice
    notes: Optional[str] = None
    recorded_by: Optional[str] = None  # user_id
    payment_date: date
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "payments"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("lease_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel(
                [("mpesa_checkout_request_id", ASCENDING)],
                unique=True,
                name="mpesa_checkout_request_id_unique",
                partialFilterExpression={"mpesa_checkout_request_id": {"$type": "string"}},
            ),
        ]
