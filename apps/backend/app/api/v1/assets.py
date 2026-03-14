"""Assets API endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.asset import (
    AssetCheckinRequest,
    AssetCheckoutRequest,
    AssetCountsResponse,
    AssetCreateRequest,
    AssetDisposeRequest,
    AssetListResponse,
    AssetMaintenanceRequest,
    AssetResponse,
    AssetTransferRequest,
    AssetUpdateRequest,
    AssetValuationRequest,
    AssetWriteOffRequest,
)
from app.services import asset_service

router = APIRouter(tags=["assets"])


@router.post(
    "/assets",
    response_model=AssetResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_asset(
    request: AssetCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.create_asset(request, current_user)


@router.get(
    "/assets/counts",
    response_model=AssetCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_asset_counts(
    property_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetCountsResponse:
    return await asset_service.get_asset_counts(current_user, property_id)


@router.get(
    "/assets",
    response_model=AssetListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_assets(
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    lifecycle_status: Optional[str] = Query(None),
    condition: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetListResponse:
    return await asset_service.list_assets(
        current_user,
        property_id=property_id,
        unit_id=unit_id,
        category=category,
        lifecycle_status=lifecycle_status,
        condition=condition,
        assigned_to=assigned_to,
        search=search,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/assets/{asset_id}",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_asset(
    asset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.get_asset(asset_id, current_user)


@router.patch(
    "/assets/{asset_id}",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_asset(
    asset_id: str,
    request: AssetUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.update_asset(asset_id, request, current_user)


@router.delete(
    "/assets/{asset_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_asset(
    asset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await asset_service.delete_asset(asset_id, current_user)


@router.post(
    "/assets/{asset_id}/transfer",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def transfer_asset(
    asset_id: str,
    request: AssetTransferRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.transfer_asset(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/checkout",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def checkout_asset(
    asset_id: str,
    request: AssetCheckoutRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.checkout_asset(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/checkin",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def checkin_asset(
    asset_id: str,
    request: AssetCheckinRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.checkin_asset(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/maintenance",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_maintenance_record(
    asset_id: str,
    request: AssetMaintenanceRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.add_maintenance_record(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/valuations",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def add_valuation(
    asset_id: str,
    request: AssetValuationRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.add_valuation(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/dispose",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def dispose_asset(
    asset_id: str,
    request: AssetDisposeRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.dispose_asset(asset_id, request, current_user)


@router.post(
    "/assets/{asset_id}/write-off",
    response_model=AssetResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def write_off_asset(
    asset_id: str,
    request: AssetWriteOffRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> AssetResponse:
    return await asset_service.write_off_asset(asset_id, request, current_user)
