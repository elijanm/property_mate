from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from redis.asyncio import Redis

from app.dependencies.auth import get_current_user, CurrentUser
from app.dependencies.redis import get_redis_dep
from app.repositories.user_repository import user_repository
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RefreshRequest,
    RefreshResponse,
    SignupRequest,
    SignupVerifyRequest,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class MeResponse(BaseModel):
    user_id: str
    org_id: Optional[str]
    role: str
    email: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    phone: Optional[str]


@router.get("/me", response_model=MeResponse)
async def me(current_user: CurrentUser = Depends(get_current_user)) -> MeResponse:
    """Return the authenticated user's profile including phone number."""
    user = await user_repository.get_by_id(current_user.user_id)
    return MeResponse(
        user_id=current_user.user_id,
        org_id=current_user.org_id,
        role=current_user.role,
        email=str(user.email) if user and user.email else None,
        first_name=user.first_name if user else None,
        last_name=user.last_name if user else None,
        phone=user.phone if user else None,
    )


class UpdateEmailRequest(BaseModel):
    email: str


class UpdateEmailResponse(BaseModel):
    is_disposable: bool
    attempts: int
    email: str
    user: MeResponse


async def _run_disposable_check(email: str) -> "CheckEmailResponse":
    """Re-use the same check logic without going through HTTP."""
    from app.core.config import settings
    import httpx
    if not settings.disposable_email_check_url:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                settings.disposable_email_check_url,
                headers={"X-Api-Key": settings.disposable_email_api_key},
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


@router.patch("/me/email", response_model=UpdateEmailResponse)
async def update_my_email(
    request: UpdateEmailRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> UpdateEmailResponse:
    """Update email — re-checks against disposable service.
    If clean: saves + clears flags. If still disposable: increments attempt counter."""
    from fastapi import HTTPException
    user = await user_repository.get_by_id(current_user.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    check = await _run_disposable_check(request.email)

    if check.is_disposable and check.confidence != "unavailable":
        # Still disposable — increment counter, don't save the email
        user.disposable_email_attempts = (user.disposable_email_attempts or 0) + 1
        user.disposable_email_used = True
        await user_repository.update(user)
        return UpdateEmailResponse(
            is_disposable=True,
            attempts=user.disposable_email_attempts,
            email=str(user.email),
            user=MeResponse(
                user_id=current_user.user_id, org_id=current_user.org_id,
                role=current_user.role, email=str(user.email),
                first_name=user.first_name, last_name=user.last_name, phone=user.phone,
            ),
        )

    # Clean email — save it and clear all disposable flags
    user.email = request.email  # type: ignore[assignment]
    user.disposable_email_used = False
    user.disposable_email_ignored = False
    user.disposable_email_attempts = 0
    await user_repository.update(user)
    return UpdateEmailResponse(
        is_disposable=False,
        attempts=0,
        email=request.email,
        user=MeResponse(
            user_id=current_user.user_id, org_id=current_user.org_id,
            role=current_user.role, email=request.email,
            first_name=user.first_name, last_name=user.last_name, phone=user.phone,
        ),
    )


@router.post("/me/email/ignore")
async def ignore_disposable_email(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """User chose to keep their disposable email — flag the account."""
    user = await user_repository.get_by_id(current_user.user_id)
    if user:
        user.disposable_email_used = True
        user.disposable_email_ignored = True
        await user_repository.update(user)
    return {"ok": True}


@router.post("/login", response_model=LoginResponse, status_code=200)
async def login(
    request: LoginRequest,
    redis: Redis = Depends(get_redis_dep),
) -> LoginResponse:
    return await auth_service.login(request.email, request.password, redis)


@router.post("/refresh", response_model=RefreshResponse, status_code=200)
async def refresh(
    request: RefreshRequest,
    redis: Redis = Depends(get_redis_dep),
) -> RefreshResponse:
    return await auth_service.refresh(request.refresh_token, redis)


@router.post("/logout", response_model=LogoutResponse, status_code=200)
async def logout(
    request: RefreshRequest,
    _current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> LogoutResponse:
    await auth_service.logout(request.refresh_token, redis)
    return LogoutResponse(ok=True)


@router.post("/signup", status_code=200)
async def signup(
    request: SignupRequest,
    redis: Redis = Depends(get_redis_dep),
) -> dict:
    return await auth_service.signup_request(
        request.email,
        request.password,
        request.first_name,
        request.last_name,
        request.org_name,
        redis,
    )


@router.post("/signup/verify-otp", response_model=LoginResponse, status_code=200)
async def signup_verify_otp(
    request: SignupVerifyRequest,
    redis: Redis = Depends(get_redis_dep),
) -> LoginResponse:
    return await auth_service.signup_verify(request.email, request.otp, redis)


class CheckEmailRequest(BaseModel):
    email: str


class CheckEmailResponse(BaseModel):
    is_disposable: bool
    risk_score: float
    confidence: str


@router.post("/check-email", response_model=CheckEmailResponse)
async def check_email(request: CheckEmailRequest) -> CheckEmailResponse:
    """Check if an email address is disposable using the ML inference service.
    Always returns a safe fallback if the inference service is unavailable."""
    from app.core.config import settings
    import httpx

    if not settings.disposable_email_check_url:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                settings.disposable_email_check_url,
                headers={"X-Api-Key": settings.disposable_email_api_key, "Content-Type": "application/json"},
                json={"inputs": {"email": request.email}},
            )
            resp.raise_for_status()
            data = resp.json()
            # Inference service wraps result under "prediction" key
            pred = data.get("prediction", data)
            return CheckEmailResponse(
                is_disposable=bool(pred.get("is_disposable", False)),
                risk_score=float(pred.get("risk_score", 0.0)),
                confidence=str(pred.get("confidence", "low")),
            )
    except Exception:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")
