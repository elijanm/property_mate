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
