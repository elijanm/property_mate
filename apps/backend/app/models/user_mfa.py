import uuid
from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class UserMfa(Document):
    """TOTP-based MFA configuration per user."""
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    user_id: str
    org_id: Optional[str] = None      # None for superadmin
    is_active: bool = False            # True once enrollment is confirmed
    totp_secret_enc: Optional[str] = None  # Fernet-encrypted base32 TOTP secret
    enrolled_at: Optional[datetime] = None
    last_verified_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "user_mfa"
        indexes = [
            IndexModel([("user_id", ASCENDING)], unique=True),
            IndexModel([("org_id", ASCENDING)]),
        ]
