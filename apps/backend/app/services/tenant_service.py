"""
Tenant service — create and manage tenant users within an org.
"""
import structlog
from passlib.context import CryptContext

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import PaginationParams
from app.models.user import User
from app.repositories.user_repository import user_repository
from app.schemas.tenant import (
    TenantCreateRequest,
    TenantListResponse,
    TenantResponse,
    TenantUpdateRequest,
)

logger = structlog.get_logger(__name__)

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _to_response(user: User) -> TenantResponse:
    return TenantResponse(
        id=str(user.id),
        email=str(user.email),
        first_name=user.first_name,
        last_name=user.last_name,
        phone=user.phone,
        org_id=user.org_id or "",
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def create_tenant(current_user: CurrentUser, req: TenantCreateRequest) -> TenantResponse:
    existing = await user_repository.get_by_email(str(req.email))
    if existing:
        raise ConflictError(f"Email '{req.email}' is already registered")

    user = User(
        email=req.email,
        hashed_password=_pwd_context.hash(req.password),
        org_id=current_user.org_id,
        role="tenant",
        first_name=req.first_name,
        last_name=req.last_name,
        phone=req.phone,
    )
    await user_repository.create(user)

    logger.info(
        "tenant_created",
        action="create_tenant",
        resource_type="user",
        resource_id=user.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(user)


async def list_tenants(
    current_user: CurrentUser, pagination: PaginationParams, phone: str | None = None
) -> TenantListResponse:
    items, total = await user_repository.list_tenants(
        org_id=current_user.org_id,
        skip=pagination.skip,
        limit=pagination.page_size,
        phone=phone,
    )
    return TenantListResponse(
        items=[_to_response(u) for u in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


async def get_tenant(current_user: CurrentUser, tenant_id: str) -> TenantResponse:
    user = await user_repository.get_tenant_by_id(tenant_id, current_user.org_id)
    if not user:
        raise ResourceNotFoundError("Tenant", tenant_id)
    return _to_response(user)


async def update_tenant(
    current_user: CurrentUser, tenant_id: str, req: TenantUpdateRequest
) -> TenantResponse:
    user = await user_repository.get_tenant_by_id(tenant_id, current_user.org_id)
    if not user:
        raise ResourceNotFoundError("Tenant", tenant_id)

    updates = req.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(user, key, value)

    updated = await user_repository.update(user)
    logger.info(
        "tenant_updated",
        action="update_tenant",
        resource_type="user",
        resource_id=tenant_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(updated)
