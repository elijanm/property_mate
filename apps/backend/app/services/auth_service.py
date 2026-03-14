import json
import uuid
from datetime import timedelta
from typing import Optional

import structlog
from jose import jwt
from passlib.context import CryptContext
from redis.asyncio import Redis

from app.core.config import settings
from app.core.exceptions import UnauthorizedError
from app.models.user import User
from app.repositories.user_repository import user_repository
from app.schemas.auth import LoginResponse, RefreshResponse, UserInfo
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")

# Refresh token lives for 7 days; stored in Redis as plain string key
_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7
_REFRESH_KEY_PREFIX = "refresh:"


# ── Password helpers ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ── Token helpers ────────────────────────────────────────────────────────────

def create_access_token(user_id: str, org_id: Optional[str], role: str) -> str:
    expire = utc_now() + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "org_id": org_id, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def _create_refresh_token(user_id: str, org_id: Optional[str], redis: Redis) -> str:
    token_id = str(uuid.uuid4())
    await redis.setex(
        f"{_REFRESH_KEY_PREFIX}{token_id}",
        _REFRESH_TTL_SECONDS,
        json.dumps({"user_id": user_id, "org_id": org_id}),
    )
    return token_id


async def _revoke_refresh_token(token_id: str, redis: Redis) -> None:
    await redis.delete(f"{_REFRESH_KEY_PREFIX}{token_id}")


# ── Public service methods ───────────────────────────────────────────────────

async def login(email: str, password: str, redis: Redis) -> LoginResponse:
    logger.info(
        "auth_login_started",
        action="login",
        resource_type="user",
        status="started",
    )

    user: Optional[User] = await user_repository.get_by_email(email)

    if not user or not verify_password(password, user.hashed_password):
        logger.warning(
            "auth_login_failed",
            action="login",
            resource_type="user",
            status="error",
            error_code="INVALID_CREDENTIALS",
        )
        raise UnauthorizedError("Invalid email or password")

    if not user.is_active:
        raise UnauthorizedError("Account is suspended")

    user_id_str = str(user.id)
    access_token = create_access_token(user_id_str, user.org_id, user.role)
    refresh_token = await _create_refresh_token(user_id_str, user.org_id, redis)

    logger.info(
        "auth_login_success",
        action="login",
        resource_type="user",
        resource_id=user_id_str,
        org_id=user.org_id,
        user_id=user_id_str,
        status="success",
    )

    return LoginResponse(
        token=access_token,
        refresh_token=refresh_token,
        user=UserInfo(
            user_id=user_id_str,
            org_id=user.org_id,
            role=user.role,
            email=str(user.email),
        ),
    )


async def refresh(refresh_token: str, redis: Redis) -> RefreshResponse:
    raw = await redis.get(f"{_REFRESH_KEY_PREFIX}{refresh_token}")
    if not raw:
        raise UnauthorizedError("Refresh token is invalid or has expired")

    data = json.loads(raw)
    user_id: str = data["user_id"]
    org_id: Optional[str] = data.get("org_id")

    user = await user_repository.get_by_id(user_id)
    if not user or not user.is_active:
        await _revoke_refresh_token(refresh_token, redis)
        raise UnauthorizedError("User not found or suspended")

    new_access_token = create_access_token(user_id, user.org_id, user.role)

    logger.info(
        "auth_token_refreshed",
        action="refresh_token",
        resource_type="user",
        resource_id=user_id,
        org_id=org_id,
        user_id=user_id,
        status="success",
    )

    return RefreshResponse(token=new_access_token)


async def logout(refresh_token: str, redis: Redis) -> None:
    await _revoke_refresh_token(refresh_token, redis)
    logger.info(
        "auth_logout",
        action="logout",
        resource_type="user",
        status="success",
    )
