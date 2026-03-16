from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    org_name: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class SignupVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


class UserInfo(BaseModel):
    user_id: str
    org_id: Optional[str]
    role: str
    email: str


class LoginResponse(BaseModel):
    token: str
    refresh_token: str
    user: UserInfo


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    token: str


class LogoutResponse(BaseModel):
    ok: bool
