import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class DepositDeduction(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    lease_id: str
    tenant_id: str
    # category: damage | cleaning | unpaid_rent | other
    category: str
    description: str
    amount: float
    evidence_keys: List[str] = []  # S3 keys
    approved_by: Optional[str] = None  # user_id
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "deposit_deductions"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("lease_id", ASCENDING)]),
        ]
