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
    role: str = "viewer"          # viewer | engineer | admin | annotator
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
    # Security OTP (used to confirm sensitive actions, e.g. password change)
    security_otp: Optional[str] = None
    security_otp_expires_at: Optional[datetime] = None
    is_onboarded: bool = False        # False until user completes workspace-setup wizard
    created_at: datetime = Field(default_factory=utc_now)
    last_login_at: Optional[datetime] = None
    # Disposable email tracking
    disposable_email_used: bool = False
    disposable_email_ignored: bool = False
    disposable_email_attempts: int = 0
    # Coupon
    pending_coupon_code: Optional[str] = None  # set at registration, cleared after redemption

    class Settings:
        name = "ml_users"
        indexes = [IndexModel([("email", ASCENDING)], unique=True)]
