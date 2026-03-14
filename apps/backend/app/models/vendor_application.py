import secrets
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class VendorApplication(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    listing_id: Optional[str] = None

    # Applicant fields
    company_name: str
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    service_categories: List[str] = []
    cover_letter: Optional[str] = None

    # Fee
    fee_paid: bool = False
    fee_amount: float = 0.0
    fee_reference: Optional[str] = None

    # Status
    status: str = "submitted"
    # submitted | under_review | approved | rejected | withdrawn

    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None

    # Link to created profile on approval
    vendor_profile_id: Optional[str] = None

    application_token: str = Field(default_factory=lambda: secrets.token_urlsafe(32))

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "vendor_applications"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("listing_id", ASCENDING)]),
            IndexModel(
                [("application_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"application_token": {"$type": "string"}},
            ),
        ]
