from datetime import date, datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class ContractSignature(BaseModel):
    signed_by: str          # user_id or "vendor"
    signed_by_name: str
    signed_at: datetime
    ip_address: Optional[str] = None
    signature_key: Optional[str] = None  # S3 key for signature PNG


class VendorContract(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    vendor_profile_id: str
    listing_id: Optional[str] = None

    title: str
    content: str  # full contract markdown text

    start_date: date
    end_date: date
    auto_renew: bool = False
    renewal_notice_days: int = 30

    contract_fee: float = 0.0
    fee_paid: bool = False

    status: str = "draft"
    # draft | sent | vendor_signed | org_signed | active | expired | terminated

    vendor_token: Optional[str] = None  # public token for vendor signing link
    vendor_signature: Optional[ContractSignature] = None
    org_signature: Optional[ContractSignature] = None

    sent_at: Optional[datetime] = None
    activated_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None
    termination_reason: Optional[str] = None

    created_by: str
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "vendor_contracts"
        indexes = [
            IndexModel(
                [
                    ("org_id", ASCENDING),
                    ("vendor_profile_id", ASCENDING),
                    ("status", ASCENDING),
                ]
            ),
            IndexModel(
                [("vendor_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"vendor_token": {"$type": "string"}},
            ),
        ]
