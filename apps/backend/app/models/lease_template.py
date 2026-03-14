import uuid
from datetime import datetime
from typing import Optional, List

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class LeaseTemplateUtility(BaseModel):
    key: str
    label: str
    type: str   # flat | metered
    rate: Optional[float] = None
    deposit: Optional[float] = None


class LeaseTemplate(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    name: str
    description: Optional[str] = None
    rent_amount: float
    deposit_amount: float
    deposit_rule: str = "one_month"  # one_month | two_months | fixed
    utility_deposit: Optional[float] = None
    utilities: List[LeaseTemplateUtility] = []
    early_termination_penalty_type: str = "months"
    early_termination_penalty_value: float = 2.0
    notice_days: int = 30
    additional_clauses: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_by: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "lease_templates"
        indexes = [IndexModel([("org_id", ASCENDING), ("deleted_at", ASCENDING)])]
