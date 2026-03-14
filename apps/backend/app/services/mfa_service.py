"""MFA service — TOTP enrollment, verification, session token management."""
import secrets
from typing import Optional

from fastapi import HTTPException
from redis.asyncio import Redis

from app.core.config import settings
from app.core.logging import get_logger
from app.dependencies.auth import CurrentUser
from app.repositories.mfa_repository import mfa_repository
from app.repositories.user_repository import user_repository
from app.schemas.mfa import (
    MfaSetupResponse,
    MfaStatusResponse,
    MfaUserStatusResponse,
    MfaVerifyResponse,
)
from app.utils.datetime import utc_now
from app.utils.encryption import decrypt, encrypt
from app.utils.totp_util import generate_secret, get_totp_uri, verify_totp

logger = get_logger(__name__)

_SESSION_PREFIX = "mfa_session:"


class MfaService:
    # ── Status ────────────────────────────────────────────────────────────────

    async def get_status(self, user_id: str) -> MfaStatusResponse:
        record = await mfa_repository.get_by_user_id(user_id)
        if not record or not record.is_active:
            return MfaStatusResponse(enrolled=False)
        return MfaStatusResponse(enrolled=True, enrolled_at=record.enrolled_at)

    # ── Setup (generates secret + QR URI) ─────────────────────────────────────

    async def setup(self, current_user: CurrentUser) -> MfaSetupResponse:
        user = await user_repository.get_by_id(current_user.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        secret = generate_secret()
        # Store encrypted secret (not yet active — must confirm)
        await mfa_repository.upsert(
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            totp_secret_enc=encrypt(secret),
            is_active=False,
        )
        qr_uri = get_totp_uri(secret, user.email, issuer=settings.mfa_issuer_name)
        logger.info(
            "mfa_setup_initiated",
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            action="mfa_setup",
            resource_type="user_mfa",
            status="started",
        )
        return MfaSetupResponse(qr_uri=qr_uri, secret=secret)

    # ── Confirm enrollment ─────────────────────────────────────────────────────

    async def confirm(self, current_user: CurrentUser, code: str) -> bool:
        record = await mfa_repository.get_by_user_id(current_user.user_id)
        if not record or not record.totp_secret_enc:
            raise HTTPException(status_code=400, detail="MFA setup not initiated")

        secret = decrypt(record.totp_secret_enc)
        if not verify_totp(secret, code):
            raise HTTPException(status_code=400, detail="Invalid TOTP code")

        await mfa_repository.upsert(
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            is_active=True,
            enrolled_at=utc_now(),
        )
        logger.info(
            "mfa_enrolled",
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            action="mfa_confirm",
            resource_type="user_mfa",
            status="success",
        )
        return True

    # ── Verify PIN → issue session token ──────────────────────────────────────

    async def verify(
        self, current_user: CurrentUser, code: str, redis: Redis
    ) -> MfaVerifyResponse:
        record = await mfa_repository.get_by_user_id(current_user.user_id)
        if not record or not record.is_active or not record.totp_secret_enc:
            raise HTTPException(status_code=403, detail="MFA not enrolled")

        secret = decrypt(record.totp_secret_enc)
        if not verify_totp(secret, code):
            logger.warning(
                "mfa_verify_failed",
                user_id=current_user.user_id,
                action="mfa_verify",
                resource_type="user_mfa",
                status="error",
                error_code="INVALID_MFA_CODE",
            )
            return MfaVerifyResponse(valid=False)

        # Issue a short-lived session token stored in Redis
        token = secrets.token_urlsafe(32)
        ttl = settings.mfa_session_ttl_seconds
        redis_key = f"{_SESSION_PREFIX}{current_user.user_id}:{token}"
        await redis.set(redis_key, "1", ex=ttl)

        # Update last_verified_at
        await mfa_repository.upsert(
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            last_verified_at=utc_now(),
        )
        logger.info(
            "mfa_verified",
            user_id=current_user.user_id,
            action="mfa_verify",
            resource_type="user_mfa",
            status="success",
        )
        return MfaVerifyResponse(valid=True, session_token=token, expires_in=ttl)

    # ── Validate session token (used by PII-gated endpoints) ──────────────────

    async def validate_session(
        self, user_id: str, token: str, redis: Redis
    ) -> bool:
        redis_key = f"{_SESSION_PREFIX}{user_id}:{token}"
        val = await redis.get(redis_key)
        return val is not None

    # ── Admin: list users + MFA status ────────────────────────────────────────

    async def list_users(self, current_user: CurrentUser) -> list[MfaUserStatusResponse]:
        if current_user.role == "superadmin":
            users = await user_repository.list_all_active()
        else:
            users = await user_repository.list_by_org(current_user.org_id)

        result = []
        for user in users:
            mfa = await mfa_repository.get_by_user_id(user.id)
            result.append(MfaUserStatusResponse(
                user_id=str(user.id),
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                role=user.role,
                enrolled=bool(mfa and mfa.is_active),
                enrolled_at=mfa.enrolled_at if mfa else None,
                last_verified_at=mfa.last_verified_at if mfa else None,
            ))
        return result

    # ── Admin: revoke user's MFA ───────────────────────────────────────────────

    async def revoke(self, target_user_id: str, current_user: CurrentUser) -> None:
        target = await user_repository.get_by_id(target_user_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

        # Org boundary check
        if current_user.role != "superadmin" and target.org_id != current_user.org_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        await mfa_repository.upsert(
            user_id=target_user_id,
            org_id=target.org_id,
            is_active=False,
            enrolled_at=None,
            totp_secret_enc=None,
        )
        logger.info(
            "mfa_revoked",
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            action="mfa_revoke",
            resource_type="user_mfa",
            resource_id=target_user_id,
            status="success",
        )


mfa_service = MfaService()
