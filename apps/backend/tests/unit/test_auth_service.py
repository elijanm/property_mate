import json

import fakeredis.aioredis
import pytest
import pytest_asyncio

from app.core.exceptions import UnauthorizedError
from app.services.auth_service import (
    create_access_token,
    hash_password,
    verify_password,
    login,
    refresh,
    logout,
    _REFRESH_KEY_PREFIX,
)
from app.models.user import User


pytestmark = pytest.mark.asyncio


# ── Password helpers ─────────────────────────────────────────────────────────

def test_hash_password_produces_argon2_hash():
    hashed = hash_password("mypassword")
    assert hashed.startswith("$argon2")


def test_verify_password_correct():
    hashed = hash_password("correct")
    assert verify_password("correct", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("correct")
    assert verify_password("wrong", hashed) is False


# ── JWT creation ─────────────────────────────────────────────────────────────

def test_create_access_token_has_expected_claims():
    from jose import jwt
    from app.core.config import settings

    token = create_access_token("user_1", "org_1", "owner")
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])

    assert payload["sub"] == "user_1"
    assert payload["org_id"] == "org_1"
    assert payload["role"] == "owner"
    assert "exp" in payload


def test_create_access_token_superadmin_no_org():
    from jose import jwt
    from app.core.config import settings

    token = create_access_token("admin_1", None, "superadmin")
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["org_id"] is None


# ── login() ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


@pytest_asyncio.fixture
async def seeded_user() -> User:
    user = User(
        email="alice@example.com",
        hashed_password=hash_password("secret"),
        org_id="org_1",
        role="owner",
        is_active=True,
    )
    await user.insert()
    return user


async def test_login_returns_tokens(redis, seeded_user):
    result = await login("alice@example.com", "secret", redis)

    assert result.token
    assert result.refresh_token
    assert result.user.email == "alice@example.com"
    assert result.user.role == "owner"
    assert result.user.org_id == "org_1"

    # Refresh token must be persisted in Redis
    raw = await redis.get(f"{_REFRESH_KEY_PREFIX}{result.refresh_token}")
    assert raw is not None
    data = json.loads(raw)
    assert data["user_id"] == seeded_user.id


async def test_login_wrong_password_raises(redis, seeded_user):
    with pytest.raises(UnauthorizedError):
        await login("alice@example.com", "badpass", redis)


async def test_login_unknown_email_raises(redis):
    with pytest.raises(UnauthorizedError):
        await login("nobody@example.com", "anything", redis)


async def test_login_inactive_user_raises(redis):
    inactive = User(
        email="inactive@example.com",
        hashed_password=hash_password("secret"),
        org_id="org_1",
        role="tenant",
        is_active=False,
    )
    await inactive.insert()

    with pytest.raises(UnauthorizedError):
        await login("inactive@example.com", "secret", redis)


# ── refresh() ────────────────────────────────────────────────────────────────

async def test_refresh_returns_new_token(redis, seeded_user):
    login_result = await login("alice@example.com", "secret", redis)
    result = await refresh(login_result.refresh_token, redis)
    assert result.token  # new access token is returned


async def test_refresh_invalid_token_raises(redis):
    with pytest.raises(UnauthorizedError):
        await refresh("non-existent-token-id", redis)


# ── logout() ─────────────────────────────────────────────────────────────────

async def test_logout_revokes_refresh_token(redis, seeded_user):
    login_result = await login("alice@example.com", "secret", redis)
    token_id = login_result.refresh_token

    await logout(token_id, redis)

    # Token must be gone from Redis
    raw = await redis.get(f"{_REFRESH_KEY_PREFIX}{token_id}")
    assert raw is None

    # Subsequent refresh must fail
    with pytest.raises(UnauthorizedError):
        await refresh(token_id, redis)
