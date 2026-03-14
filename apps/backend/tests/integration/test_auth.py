import pytest
from httpx import AsyncClient

from app.models.user import User


pytestmark = pytest.mark.asyncio


# ── POST /api/v1/auth/login ──────────────────────────────────────────────────

async def test_login_success(async_client: AsyncClient, owner_user: User):
    res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "secret123"},
    )
    assert res.status_code == 200
    body = res.json()
    assert "token" in body
    assert "refresh_token" in body
    assert body["user"]["email"] == "owner@example.com"
    assert body["user"]["role"] == "owner"
    assert body["user"]["org_id"] == "org_test"


async def test_login_wrong_password(async_client: AsyncClient, owner_user: User):
    res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongpass"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_login_unknown_email(async_client: AsyncClient):
    res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "anything"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_login_inactive_user(async_client: AsyncClient, inactive_user: User):
    res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "suspended@example.com", "password": "secret123"},
    )
    assert res.status_code == 401


async def test_login_invalid_email_format(async_client: AsyncClient):
    res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email", "password": "anything"},
    )
    assert res.status_code == 422


# ── POST /api/v1/auth/refresh ────────────────────────────────────────────────

async def test_refresh_success(async_client: AsyncClient, owner_user: User):
    # First log in to get a refresh token
    login_res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "secret123"},
    )
    refresh_token = login_res.json()["refresh_token"]

    res = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert res.status_code == 200
    assert "token" in res.json()


async def test_refresh_invalid_token(async_client: AsyncClient):
    res = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


# ── POST /api/v1/auth/logout ─────────────────────────────────────────────────

async def test_logout_success(async_client: AsyncClient, owner_user: User):
    login_res = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "secret123"},
    )
    data = login_res.json()
    access_token = data["token"]
    refresh_token = data["refresh_token"]

    res = await async_client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refresh_token},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}

    # Refresh token is now revoked — refresh must fail
    revoked_res = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert revoked_res.status_code == 401


async def test_logout_requires_auth(async_client: AsyncClient):
    res = await async_client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": "any-token"},
    )
    assert res.status_code == 401
