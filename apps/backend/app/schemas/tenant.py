from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class TenantCreateRequest(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    phone: Optional[str] = None
    password: str = Field(min_length=8)


class TenantUpdateRequest(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class TenantResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    phone: Optional[str]
    org_id: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TenantListResponse(BaseModel):
    items: List[TenantResponse]
    total: int
    page: int
    page_size: int
