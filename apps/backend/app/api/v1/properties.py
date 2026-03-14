from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.config import settings
from app.core.s3 import generate_presigned_url, get_s3_client, s3_path
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.dependencies.redis import get_redis_dep
from app.models.org import SignatureConfig
from app.repositories.property_repository import property_repository
from app.schemas.property import (
    LateFeeSettingRequest,
    PaymentConfigUpdateRequest,
    PropertyCreateRequest,
    PropertyCreateResponse,
    PropertyInventoryConfigUpdateRequest,
    PropertyListResponse,
    PropertyResponse,
    PropertyUpdateRequest,
    SignatureConfigUpdateRequest,
)
from app.services import property_service

router = APIRouter(prefix="/properties", tags=["properties"])


class _AppInstallBody(BaseModel):
    app_id: str


@router.post(
    "",
    response_model=PropertyCreateResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_property(
    request: PropertyCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> PropertyCreateResponse:
    return await property_service.create_property(request, current_user, redis)


@router.get(
    "",
    response_model=PropertyListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_properties(
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    status: Optional[str] = Query(default=None, description="Filter by status"),
    org_id: Optional[str] = Query(default=None, description="Superadmin only: filter by org"),
) -> PropertyListResponse:
    # Only superadmin may query a different org; all other roles see their own org only
    effective_org_id = org_id if (org_id and current_user.role == "superadmin") else None
    return await property_service.list_properties(current_user, pagination, status, effective_org_id)


@router.get(
    "/{property_id}",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_property(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    return await property_service.get_property(property_id, current_user)


@router.patch(
    "/{property_id}",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_property(
    property_id: str,
    req: PropertyUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    return await property_service.update_property(current_user, property_id, req)


@router.patch(
    "/{property_id}/payment-config",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_payment_config(
    property_id: str,
    req: PaymentConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    return await property_service.update_payment_config(property_id, req, current_user)


async def _property_to_response(prop) -> PropertyResponse:
    """Build PropertyResponse, resolving signature_config signature_key to presigned URL."""
    data = prop.model_dump()
    if prop.signature_config and prop.signature_config.signature_key:
        try:
            sig_url = await generate_presigned_url(prop.signature_config.signature_key)
            sig_cfg = SignatureConfig(**{**prop.signature_config.model_dump(), "signature_key": sig_url})
            data["signature_config"] = sig_cfg.model_dump()
        except Exception:
            pass
    data["id"] = str(data["id"])
    return PropertyResponse(**data)


@router.post(
    "/{property_id}/signature",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def upload_property_signature(
    property_id: str,
    file: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    """Upload a property-level default countersignature image (overrides org default)."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    ext = (file.filename or "sig").rsplit(".", 1)[-1].lower()
    key = s3_path(current_user.org_id, "property", property_id, f"signature.{ext}")

    async with get_s3_client() as s3:
        await s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            key,
            ExtraArgs={"ContentType": file.content_type},
        )

    sig_data = prop.signature_config.model_dump() if prop.signature_config else {}
    sig_data["signature_key"] = key
    prop = await property_repository.update(property_id, current_user.org_id, {"signature_config": sig_data})
    return await _property_to_response(prop)


@router.patch(
    "/{property_id}/signature-config",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_property_signature_config(
    property_id: str,
    req: SignatureConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    """Update the property-level signatory name/title."""
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    sig_data = prop.signature_config.model_dump() if prop.signature_config else {}
    if req.signatory_name is not None:
        sig_data["signatory_name"] = req.signatory_name
    if req.signatory_title is not None:
        sig_data["signatory_title"] = req.signatory_title
    prop = await property_repository.update(property_id, current_user.org_id, {"signature_config": sig_data})
    return await _property_to_response(prop)


@router.delete(
    "/{property_id}/signature",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_property_signature(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    """Remove the property-level signature override (falls back to org default)."""
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    prop = await property_repository.update(property_id, current_user.org_id, {"signature_config": None})
    return await _property_to_response(prop)


@router.post(
    "/{property_id}/apps/install",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def install_app(
    property_id: str,
    body: _AppInstallBody,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    return await property_service.install_app(property_id, body.app_id, current_user)


@router.delete(
    "/{property_id}/apps/{app_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def uninstall_app(
    property_id: str,
    app_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await property_service.uninstall_app(property_id, app_id, current_user)


@router.patch(
    "/{property_id}/inventory-config",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_inventory_config(
    property_id: str,
    req: PropertyInventoryConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    return await property_service.update_inventory_config(property_id, req, current_user)


@router.patch(
    "/{property_id}/late-fee-setting",
    response_model=PropertyResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_late_fee_setting(
    property_id: str,
    data: LateFeeSettingRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PropertyResponse:
    from app.models.property import LateFeeSetting
    from app.utils.datetime import utc_now
    prop_doc = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    prop_doc.late_fee_setting = LateFeeSetting(**data.model_dump())
    prop_doc.updated_at = utc_now()
    await prop_doc.save()
    return property_service._to_response(prop_doc)


class _BulkDiscountRequest(BaseModel):
    label: str
    type: str  # "fixed" | "percentage"
    value: float
    effective_from: str  # ISO date string "YYYY-MM-DD"
    effective_to: Optional[str] = None
    note: Optional[str] = None


@router.post(
    "/{property_id}/bulk-discount",
    status_code=200,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def apply_bulk_discount(
    property_id: str,
    data: _BulkDiscountRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    from datetime import date as _date
    from app.models.lease import LeaseDiscount
    from app.repositories.lease_repository import lease_repository as lr
    from app.utils.datetime import utc_now

    prop_doc = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop_doc:
        raise HTTPException(status_code=404, detail="Property not found")

    leases = await lr.list_by_property(property_id, current_user.org_id)
    active_leases = [l for l in leases if l.status == "active"]
    count = 0
    eff_from = _date.fromisoformat(data.effective_from)
    eff_to = _date.fromisoformat(data.effective_to) if data.effective_to else None
    for lease in active_leases:
        disc = LeaseDiscount(
            label=data.label,
            type=data.type,
            value=data.value,
            effective_from=eff_from,
            effective_to=eff_to,
            note=data.note,
            recorded_by=current_user.user_id,
        )
        lease.discounts = (lease.discounts or []) + [disc]
        lease.updated_at = utc_now()
        await lease.save()
        count += 1
    return {"applied_to": count, "leases": count}
