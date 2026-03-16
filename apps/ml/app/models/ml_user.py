"""MLDock.io user accounts."""
from typing import Optional
from datetime import datetime
from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field
from app.utils.datetime import utc_now


class MLUser(Document):
    email: str
    hashed_password: str
    full_name: str = ""
    role: str = "viewer"          # viewer | engineer | admin
    org_id: str = ""              # tenant workspace — all records scoped to this
    is_active: bool = True
    # Email verification
    is_verified: bool = False
    verification_token: Optional[str] = None   # UUID for link-click activation
    verification_otp: Optional[str] = None     # 6-digit code
    otp_expires_at: Optional[datetime] = None
    # Password reset
    password_reset_token: Optional[str] = None
    password_reset_expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    last_login_at: Optional[datetime] = None

    class Settings:
        name = "ml_users"
        indexes = [IndexModel([("email", ASCENDING)], unique=True)]
