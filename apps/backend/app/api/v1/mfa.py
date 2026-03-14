"""
MFA API — TOTP enrollment, verification, and admin user management.

Routes:
  GET  /auth/mfa/status              — current user MFA status
  POST /auth/mfa/setup               — initiate enrollment (get QR + secret)
  POST /auth/mfa/setup/confirm       — confirm enrollment with first TOTP code
  POST /auth/mfa/verify              — verify code → short-lived session token
  GET  /mfa/users                    — owner/superadmin: list users + MFA status
  POST /mfa/users/{user_id}/revoke   — owner/superadmin: revoke user MFA
"""
from typing import List

from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.redis import get_redis_dep
from app.schemas.mfa import (
    MfaConfirmRequest,
    MfaSetupResponse,
    MfaStatusResponse,
    MfaUserStatusResponse,
    MfaVerifyRequest,
    MfaVerifyResponse,
)
from app.services.mfa_service import mfa_service

router = APIRouter(tags=["mfa"])


# ── Current-user MFA endpoints ────────────────────────────────────────────────

@router.get(
    "/auth/mfa/status",
    response_model=MfaStatusResponse,
    dependencies=[Depends(get_current_user)],
)
async def get_mfa_status(current_user: CurrentUser = Depends(get_current_user)):
    return await mfa_service.get_status(current_user.user_id)


@router.post(
    "/auth/mfa/setup",
    response_model=MfaSetupResponse,
    dependencies=[Depends(get_current_user)],
)
async def setup_mfa(current_user: CurrentUser = Depends(get_current_user)):
    """Generate a new TOTP secret and QR code URI for the current user."""
    return await mfa_service.setup(current_user)


@router.post(
    "/auth/mfa/setup/confirm",
    response_model=dict,
    dependencies=[Depends(get_current_user)],
)
async def confirm_mfa(
    body: MfaConfirmRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Confirm enrollment by submitting the first TOTP code from the authenticator app."""
    await mfa_service.confirm(current_user, body.code)
    return {"ok": True}


@router.post(
    "/auth/mfa/verify",
    response_model=MfaVerifyResponse,
    dependencies=[Depends(get_current_user)],
)
async def verify_mfa(
    body: MfaVerifyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
):
    """Verify a TOTP code and receive a short-lived session token for PII access."""
    return await mfa_service.verify(current_user, body.code, redis)


# ── Admin MFA management endpoints ───────────────────────────────────────────

@router.get(
    "/mfa/users",
    response_model=List[MfaUserStatusResponse],
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def list_mfa_users(current_user: CurrentUser = Depends(get_current_user)):
    """List all org users with their MFA enrollment status."""
    return await mfa_service.list_users(current_user)


@router.post(
    "/mfa/users/{user_id}/revoke",
    response_model=dict,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def revoke_user_mfa(
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Revoke MFA enrollment for a user (owner/superadmin only)."""
    await mfa_service.revoke(user_id, current_user)
    return {"ok": True}
