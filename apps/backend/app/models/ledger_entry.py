import uuid
from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class LedgerEntry(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    lease_id: str
    property_id: str
    tenant_id: str
    payment_id: Optional[str] = None
    # type: debit | credit
    type: str
    # category: rent | deposit | utility_deposit | utility | late_fee | refund | deduction
    category: str
    amount: float
    description: str
    running_balance: float
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ledger_entries"
        indexes = [
            IndexModel(
                [("org_id", ASCENDING), ("lease_id", ASCENDING), ("created_at", ASCENDING)]
            ),
            IndexModel([("org_id", ASCENDING), ("tenant_id", ASCENDING)]),
        ]
