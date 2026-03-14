import random
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.email import _base, send_email
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.dependencies.redis import get_redis_dep
from app.schemas.tenant import (
    TenantCreateRequest,
    TenantListResponse,
    TenantResponse,
    TenantUpdateRequest,
)
from app.services import tenant_service

router = APIRouter(prefix="/tenants", tags=["tenants"])

_OTP_TTL = 300  # 5 minutes


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(1, len(local) - 2)}@{domain}"


@router.get(
    "",
    response_model=TenantListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_tenants(
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    phone: str | None = Query(None),
) -> TenantListResponse:
    return await tenant_service.list_tenants(current_user, pagination, phone=phone)


@router.post(
    "",
    response_model=TenantResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_tenant(
    req: TenantCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> TenantResponse:
    return await tenant_service.create_tenant(current_user, req)


@router.get(
    "/{tenant_id}",
    response_model=TenantResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_tenant(
    tenant_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> TenantResponse:
    return await tenant_service.get_tenant(current_user, tenant_id)


@router.patch(
    "/{tenant_id}",
    response_model=TenantResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_tenant(
    tenant_id: str,
    req: TenantUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> TenantResponse:
    return await tenant_service.update_tenant(current_user, tenant_id, req)


# ── Voice Agent OTP ──────────────────────────────────────────────────────────

class OtpVerifyRequest(BaseModel):
    code: str


@router.post(
    "/{tenant_id}/otp",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def request_otp(
    tenant_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
):
    """Generate a 6-digit OTP, email it to the tenant, and store it in Redis (5 min TTL).
    Used by the voice agent to verify caller identity before sharing sensitive info.
    """
    tenant = await tenant_service.get_tenant(current_user, tenant_id)
    if not tenant.email:
        raise HTTPException(status_code=422, detail="Tenant has no email address on file")

    code = "".join(random.choices(string.digits, k=6))
    redis_key = f"voice:otp:{tenant_id}"
    await redis.set(redis_key, code, ex=_OTP_TTL)

    html = _base(
        "Your Verification Code",
        f"""
        <p>Hello {tenant.first_name or 'there'},</p>
        <p>Your one-time verification code for your phone call with our support agent is:</p>
        <h1 style="letter-spacing:8px;font-size:36px;color:#1a1a2e;">{code}</h1>
        <p>This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
        <p>If you did not request this, please ignore this email.</p>
        """,
    )
    await send_email(to=tenant.email, subject="Your Verification Code", html=html)

    return {"sent": True, "channel": "email", "masked_email": _mask_email(tenant.email)}


@router.post(
    "/{tenant_id}/otp/verify",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def verify_otp(
    tenant_id: str,
    req: OtpVerifyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
):
    """Verify a previously issued OTP. Returns {valid: true} and deletes the code on success."""
    redis_key = f"voice:otp:{tenant_id}"
    stored = await redis.get(redis_key)
    if not stored or stored != req.code.strip():
        return {"valid": False}
    await redis.delete(redis_key)
    return {"valid": True}
