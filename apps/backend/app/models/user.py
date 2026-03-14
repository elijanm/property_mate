from datetime import datetime
from typing import Optional
import uuid

from beanie import Document, PydanticObjectId
from pydantic import EmailStr, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class User(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    email: EmailStr
    hashed_password: str
    org_id: Optional[str] = None  # None only for superadmin
    role: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None
    is_active: bool = True
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("email", ASCENDING)], unique=True),
        ]
