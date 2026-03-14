from typing import Optional

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.dependencies.redis import get_redis_dep
from app.schemas.lease import (
    LeaseCreateRequest, LeaseDiscountCreateRequest, LeaseListResponse, LeaseResponse,
    RentEscalationCreateRequest, EarlyTerminationTermsRequest,
    RenewalOfferCreateRequest, CoTenantCreateRequest, LeaseNoteCreateRequest, TenantRatingRequest,
)
from app.services import lease_service

router = APIRouter(tags=["leases"])


@router.get(
    "/tenant/leases",
    response_model=LeaseListResponse,
    dependencies=[Depends(require_roles("tenant"))],
)
async def list_my_leases(
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
) -> LeaseListResponse:
    """Returns leases belonging to the authenticated tenant."""
    return await lease_service.list_leases(
        current_user=current_user,
        pagination=pagination,
        tenant_id=str(current_user.user_id),
    )


@router.get(
    "/leases",
    response_model=LeaseListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_leases_flat(
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    tenant_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> LeaseListResponse:
    """Flat lease list — for internal/superadmin queries (e.g. voice agent lookup by tenant_id)."""
    return await lease_service.list_leases(
        current_user=current_user,
        pagination=pagination,
        tenant_id=tenant_id,
        status=status,
    )


@router.post(
    "/properties/{property_id}/leases",
    response_model=LeaseResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_lease(
    property_id: str,
    request: LeaseCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.create_lease(property_id, request, current_user)


@router.get(
    "/properties/{property_id}/leases",
    response_model=LeaseListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_leases(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    status: Optional[str] = Query(default=None),
) -> LeaseListResponse:
    return await lease_service.list_leases(
        current_user=current_user,
        pagination=pagination,
        property_id=property_id,
        status=status,
    )


@router.get(
    "/leases/{lease_id}",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_lease(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.get_lease(lease_id, current_user)


@router.post(
    "/leases/{lease_id}/activate",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def activate_lease(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> LeaseResponse:
    return await lease_service.activate_lease(lease_id, current_user, redis)


@router.post(
    "/leases/{lease_id}/sign",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def sign_lease(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.sign_lease(lease_id, current_user)


@router.post(
    "/leases/{lease_id}/terminate",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def terminate_lease(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.terminate_lease(lease_id, current_user)


@router.post(
    "/leases/{lease_id}/resend-invite",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def resend_invite(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await lease_service.resend_invite(lease_id, current_user)


@router.get(
    "/leases/{lease_id}/pdf",
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_lease_pdf(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    url = await lease_service.get_lease_pdf_url(lease_id, current_user)
    return {"url": url}


@router.post(
    "/leases/{lease_id}/discounts",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def add_discount(
    lease_id: str,
    data: LeaseDiscountCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.add_discount(lease_id, data, current_user)


@router.delete(
    "/leases/{lease_id}/discounts/{discount_id}",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def remove_discount(
    lease_id: str,
    discount_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.remove_discount(lease_id, discount_id, current_user)


# ── Rent Escalation ───────────────────────────────────────────────────────────

@router.post(
    "/leases/{lease_id}/escalations",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def add_escalation(
    lease_id: str,
    data: RentEscalationCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.add_escalation(lease_id, data, current_user)


@router.delete(
    "/leases/{lease_id}/escalations/{escalation_id}",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def remove_escalation(
    lease_id: str,
    escalation_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.remove_escalation(lease_id, escalation_id, current_user)


# ── Early Termination ─────────────────────────────────────────────────────────

@router.put(
    "/leases/{lease_id}/early-termination",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def set_early_termination(
    lease_id: str,
    data: EarlyTerminationTermsRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.set_early_termination_terms(lease_id, data, current_user)


# ── Renewal Offer ─────────────────────────────────────────────────────────────

@router.post(
    "/leases/{lease_id}/renewal-offer",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_renewal_offer(
    lease_id: str,
    data: RenewalOfferCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.send_renewal_offer(lease_id, data, current_user)


@router.post(
    "/leases/{lease_id}/renewal-offer/respond",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def respond_renewal(
    lease_id: str,
    accept: bool = True,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.respond_renewal_offer(lease_id, accept, current_user)


# ── Co-tenants ────────────────────────────────────────────────────────────────

@router.post(
    "/leases/{lease_id}/co-tenants",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_co_tenant(
    lease_id: str,
    data: CoTenantCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.add_co_tenant(lease_id, data, current_user)


@router.delete(
    "/leases/{lease_id}/co-tenants/{co_tenant_id}",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def remove_co_tenant(
    lease_id: str,
    co_tenant_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.remove_co_tenant(lease_id, co_tenant_id, current_user)


# ── Notes & Rating ────────────────────────────────────────────────────────────

@router.post(
    "/leases/{lease_id}/notes",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_note(
    lease_id: str,
    data: LeaseNoteCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.add_note(lease_id, data, current_user)


@router.put(
    "/leases/{lease_id}/rating",
    response_model=LeaseResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def rate_tenant(
    lease_id: str,
    data: TenantRatingRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LeaseResponse:
    return await lease_service.rate_tenant(lease_id, data, current_user)
