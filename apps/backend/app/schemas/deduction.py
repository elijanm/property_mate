from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DeductionCreateRequest(BaseModel):
    category: str  # damage | cleaning | unpaid_rent | other
    description: str
    amount: float = Field(gt=0)


class DeductionResponse(BaseModel):
    id: str
    org_id: str
    lease_id: str
    tenant_id: str
    category: str
    description: str
    amount: float
    evidence_keys: List[str] = []
    approved_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DeductionSummary(BaseModel):
    items: List[DeductionResponse]
    total: float
