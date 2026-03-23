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
    otp: str = ""   # security OTP (required when sent via request-security-otp)


class RequestSecurityOtpRequest(BaseModel):
    action: str = "change your password"


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


@router.post("/request-security-otp")
async def request_security_otp(body: RequestSecurityOtpRequest, authorization: Optional[str] = Header(None)):
    """Send a 6-digit OTP to the user's email for confirming a sensitive action."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await auth_service.send_security_otp(user, body.action)
    return {"ok": True, "message": f"Security code sent to {user.email}"}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    """Change password. Requires current_password + OTP (request via /request-security-otp first)."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await auth_service.change_password(user, body.current_password, body.new_password, body.otp)
    return {"ok": True}


@router.post("/login")
async def login(body: LoginRequest):
    user, access, refresh = await auth_service.login(body.email, body.password)
    # Auto-mark existing users as onboarded if they've already customised their workspace
    # (prevents the setup wizard from appearing for users who registered before this feature)
    if not user.is_onboarded and user.org_id:
        try:
            from app.models.org_config import OrgConfig
            cfg = await OrgConfig.find_one({"org_id": user.org_id})
            # Consider onboarded if slug exists AND org_name was manually set
            # (auto-generated names end with "_org", e.g. "Mike_org")
            if cfg and cfg.slug and cfg.org_name and not cfg.org_name.endswith("_org"):
                await user.set({"is_onboarded": True})
                user.is_onboarded = True
        except Exception:
            pass
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": _user_dict(user),
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
    return {**_user_dict(user), "last_login_at": user.last_login_at}


class CheckEmailRequest(BaseModel):
    email: str


class CheckEmailResponse(BaseModel):
    is_disposable: bool
    risk_score: float
    confidence: str


async def _run_disposable_check(email: str) -> CheckEmailResponse:
    from app.core.config import settings
    import httpx
    if not settings.disposable_email_check_url:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            resp = await c.post(
                settings.disposable_email_check_url,
                headers={"X-Api-Key": settings.disposable_email_api_key, "Content-Type": "application/json"},
                json={"inputs": {"email": email}},
            )
            resp.raise_for_status()
            data = resp.json()
            pred = data.get("prediction", data)
            return CheckEmailResponse(
                is_disposable=bool(pred.get("is_disposable", False)),
                risk_score=float(pred.get("risk_score", 0.0)),
                confidence=str(pred.get("confidence", "low")),
            )
    except Exception:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")


@router.post("/check-email", response_model=CheckEmailResponse)
async def check_email(body: CheckEmailRequest) -> CheckEmailResponse:
    """Check if an email is disposable. Safe fallback if inference is unavailable."""
    return await _run_disposable_check(body.email)


class UpdateEmailRequest(BaseModel):
    email: str


class UpdateEmailResponse(BaseModel):
    is_disposable: bool
    attempts: int
    email: str


@router.patch("/me/email", response_model=UpdateEmailResponse)
async def update_my_email(body: UpdateEmailRequest, authorization: Optional[str] = Header(None)) -> UpdateEmailResponse:
    """Update email — re-checks disposable service. Clean: saves + clears flags. Still disposable: increments counter."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    check = await _run_disposable_check(body.email)
    if check.is_disposable and check.confidence != "unavailable":
        user.disposable_email_attempts = (user.disposable_email_attempts or 0) + 1
        user.disposable_email_used = True
        await user.save()
        return UpdateEmailResponse(is_disposable=True, attempts=user.disposable_email_attempts, email=user.email)

    user.email = body.email
    user.disposable_email_used = False
    user.disposable_email_ignored = False
    user.disposable_email_attempts = 0
    await user.save()
    return UpdateEmailResponse(is_disposable=False, attempts=0, email=body.email)


@router.post("/me/email/ignore")
async def ignore_disposable_email(authorization: Optional[str] = Header(None)) -> dict:
    """User chose to keep their disposable email — flag the account."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    user.disposable_email_used = True
    user.disposable_email_ignored = True
    await user.save()
    return {"ok": True}


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_onboarded: Optional[bool] = None


def _user_dict(user) -> dict:
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "is_onboarded": user.is_onboarded,
    }


@router.patch("/profile")
async def update_profile(body: UpdateProfileRequest, authorization: Optional[str] = Header(None)):
    """Update the authenticated user's profile (full_name and/or role)."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    # Only allow valid role upgrades: viewer → engineer
    if body.role is not None:
        allowed_roles = {"viewer", "engineer", "admin", "annotator"}
        if body.role not in allowed_roles:
            raise HTTPException(status_code=400, detail="Invalid role")
        # Viewers can only upgrade to engineer; other roles unchanged by self
        if user.role == "viewer" and body.role not in ("viewer", "engineer"):
            raise HTTPException(status_code=403, detail="Viewers may only upgrade to engineer")
        user.role = body.role

    if body.full_name is not None:
        user.full_name = body.full_name.strip()

    if body.is_onboarded is not None:
        user.is_onboarded = body.is_onboarded

    await user.save()
    return _user_dict(user)
