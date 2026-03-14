"""MLDock.io authentication endpoints."""
from typing import Optional
from fastapi import APIRouter, Header, Request
from pydantic import BaseModel

from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    invite_code: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str


class ResendVerificationRequest(BaseModel):
    email: str


@router.post("/register")
async def register(body: RegisterRequest):
    user = await auth_service.register(body.email, body.password, body.full_name)
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "pending_verification": not user.is_verified,
    }


@router.post("/verify")
async def verify_otp(body: VerifyOtpRequest):
    """Verify email with 6-digit OTP."""
    user = await auth_service.verify_by_otp(body.email, body.otp)
    return {"verified": True, "email": user.email}


@router.get("/verify/{token}")
async def verify_link(token: str):
    """Activate account via link click."""
    user = await auth_service.verify_by_token(token)
    return {"verified": True, "email": user.email}


@router.post("/resend-verification")
async def resend_verification(body: ResendVerificationRequest):
    """Resend OTP + activation link."""
    await auth_service.resend_verification(body.email)
    return {"sent": True}


@router.post("/login")
async def login(body: LoginRequest):
    user, access, refresh = await auth_service.login(body.email, body.password)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": {"email": user.email, "full_name": user.full_name, "role": user.role, "org_id": user.org_id},
    }


@router.post("/refresh")
async def refresh(body: RefreshRequest):
    payload = auth_service.decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not a refresh token")
    user = await auth_service.get_current_user(body.refresh_token)
    access = auth_service.make_access_token(user)
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me")
async def me(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    return {"email": user.email, "full_name": user.full_name, "role": user.role, "org_id": user.org_id, "last_login_at": user.last_login_at}
