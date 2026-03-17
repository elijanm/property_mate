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


class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/register")
async def register(body: RegisterRequest):
    user = await auth_service.register(body.email, body.password, body.full_name)
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "pending_verification": not user.is_verified,
    }


class InviteRegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    invite_token: str


@router.post("/register-invite")
async def register_with_invite(body: InviteRegisterRequest):
    import jwt as pyjwt
    from fastapi import HTTPException
    from app.core.config import settings
    try:
        payload = pyjwt.decode(body.invite_token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("type") != "invite":
            raise ValueError("invalid type")
        org_id = payload["org_id"]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired invite token")
    user = await auth_service.register(
        body.email, body.password, body.full_name,
        role="viewer", org_id=org_id, skip_verification=True
    )
    token = auth_service.make_access_token(user)
    return {
        "token": token,
        "user": {"email": user.email, "full_name": user.full_name, "role": user.role, "org_id": user.org_id},
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


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    """Send password reset email. Always returns ok to avoid user enumeration."""
    await auth_service.forgot_password(body.email)
    return {"ok": True}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    """Set a new password using the reset token from the email link."""
    await auth_service.reset_password(body.token, body.new_password)
    return {"ok": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    """Change password for the currently authenticated user."""
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await auth_service.change_password(user, body.current_password, body.new_password)
    return {"ok": True}


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
