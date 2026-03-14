from typing import List, Optional

from pydantic import BaseModel, Field


class LeaseTemplateUtilityRequest(BaseModel):
    key: str
    label: str
    type: str
    rate: Optional[float] = None
    deposit: Optional[float] = None


class LeaseTemplateCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    rent_amount: float = Field(gt=0)
    deposit_amount: float = Field(ge=0)
    deposit_rule: str = "one_month"
    utility_deposit: Optional[float] = None
    utilities: List[LeaseTemplateUtilityRequest] = []
    early_termination_penalty_type: str = "months"
    early_termination_penalty_value: float = 2.0
    notice_days: int = 30
    additional_clauses: Optional[str] = None


class LeaseTemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rent_amount: Optional[float] = None
    deposit_amount: Optional[float] = None
    additional_clauses: Optional[str] = None


class LeaseTemplateResponse(BaseModel):
    id: str
    org_id: str
    name: str
    description: Optional[str]
    rent_amount: float
    deposit_amount: float
    deposit_rule: str
    utility_deposit: Optional[float]
    utilities: list
    early_termination_penalty_type: str
    early_termination_penalty_value: float
    notice_days: int
    additional_clauses: Optional[str]
    created_by: str
    created_at: str
    updated_at: str
