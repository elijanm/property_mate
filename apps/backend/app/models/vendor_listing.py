from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class VendorListing(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str

    title: str
    description: str
    service_category: str
    requirements: Optional[str] = None

    application_fee: float = 0.0

    contract_template: Optional[str] = None  # markdown text
    contract_duration_months: Optional[int] = None
    contract_value: Optional[float] = None

    deadline: Optional[datetime] = None
    max_vendors: Optional[int] = None

    status: str = "draft"  # draft | open | closed | awarded

    published_at: Optional[datetime] = None
    created_by: str
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "vendor_listings"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("service_category", ASCENDING)]),
        ]
