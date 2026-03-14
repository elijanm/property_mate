from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MfaStatusResponse(BaseModel):
    enrolled: bool
    enrolled_at: Optional[datetime] = None


class MfaSetupResponse(BaseModel):
    qr_uri: str    # otpauth:// URI — frontend renders as QR code
    secret: str    # base32 secret for manual entry


class MfaConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class MfaVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class MfaVerifyResponse(BaseModel):
    valid: bool
    session_token: Optional[str] = None   # stored in Redis; valid for mfa_session_ttl_seconds
    expires_in: Optional[int] = None      # seconds until expiry


class MfaUserStatusResponse(BaseModel):
    user_id: str
    email: str
    first_name: str
    last_name: str
    role: str
    enrolled: bool
    enrolled_at: Optional[datetime] = None
    last_verified_at: Optional[datetime] = None


class MfaRevokeRequest(BaseModel):
    user_id: str
