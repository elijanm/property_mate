"""Entity-scoped alias routes.

These routes provide a unified API surface for any entity type (property, farm, site, …).
URL pattern: /entities/{entity_type}/{entity_id}/<module>

For the current platform entity_type is always "property" and entity_id == property_id,
but future entity types (farm, site) can reuse the same modules without additional routers.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.services import (
    gen_ticket_service,
    asset_service,
    inventory_service,
    cctv_service,
    store_service,
)
from app.services import whatsapp_service
from app.schemas.ticket import GeneralTicketListResponse, TicketCountsResponse
from app.schemas.asset import AssetListResponse, AssetCountsResponse
from app.schemas.inventory import InventoryListResponse, InventoryCountsResponse
from app.schemas.cctv import CCTVCameraListResponse, CCTVEventListResponse
from app.schemas.store import StoreListResponse
from app.api.v1.whatsapp import InstanceResponse

router = APIRouter(prefix="/entities", tags=["entity-aliases"])

# ── Tickets ──────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/tickets",
    response_model=GeneralTicketListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant"))],
)
async def list_entity_tickets(
    entity_type: str,
    entity_id: str,
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await gen_ticket_service.list_tickets(
        current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        unit_id=unit_id,
        tenant_id=tenant_id,
        category=category,
        status=status,
        priority=priority,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{entity_type}/{entity_id}/tickets/counts",
    response_model=TicketCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant"))],
)
async def entity_ticket_counts(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await gen_ticket_service.get_counts(
        current_user, entity_type=entity_type, entity_id=entity_id
    )


# ── Assets ───────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/assets",
    response_model=AssetListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_assets(
    entity_type: str,
    entity_id: str,
    category: Optional[str] = Query(None),
    lifecycle_status: Optional[str] = Query(None),
    condition: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await asset_service.list_assets(
        current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        category=category,
        lifecycle_status=lifecycle_status,
        condition=condition,
        assigned_to=assigned_to,
        search=search,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{entity_type}/{entity_id}/assets/counts",
    response_model=AssetCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def entity_asset_counts(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await asset_service.get_asset_counts(
        current_user, entity_type=entity_type, entity_id=entity_id
    )


# ── Inventory ─────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/inventory",
    response_model=InventoryListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_inventory(
    entity_type: str,
    entity_id: str,
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    low_stock_only: bool = Query(False),
    hazard_class: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await inventory_service.list_items(
        current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        category=category,
        status=status,
        low_stock_only=low_stock_only,
        hazard_class=hazard_class,
        search=search,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{entity_type}/{entity_id}/inventory/counts",
    response_model=InventoryCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def entity_inventory_counts(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await inventory_service.get_counts(
        current_user, entity_type=entity_type, entity_id=entity_id
    )


# ── CCTV ─────────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/cctv/cameras",
    response_model=CCTVCameraListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_cameras(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await cctv_service.list_cameras(
        property_id=entity_id,
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
    )


@router.get(
    "/{entity_type}/{entity_id}/cctv/events",
    response_model=CCTVEventListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_events(
    entity_type: str,
    entity_id: str,
    camera_id: Optional[str] = Query(None),
    is_suspicious: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await cctv_service.list_events(
        property_id=entity_id,
        current_user=current_user,
        camera_id=camera_id,
        is_suspicious=is_suspicious,
        entity_type=entity_type,
        entity_id=entity_id,
        page=page,
        page_size=page_size,
    )


# ── Stores ───────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/stores",
    response_model=StoreListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_stores(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    # For property entities delegate to store_service; for other entities query repo directly
    if entity_type == "property":
        return await store_service.list_stores(entity_id, current_user)
    from app.repositories.store_repository import store_repository
    from app.services.store_service import _to_response as store_to_response
    stores = await store_repository.list_stores(
        current_user.org_id, entity_type=entity_type, entity_id=entity_id
    )
    return StoreListResponse(items=[store_to_response(s) for s in stores], total=len(stores))


@router.get(
    "/{entity_type}/{entity_id}/stores/locations",
    response_model=list,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_store_locations(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    if entity_type == "property":
        return await store_service.list_all_locations(entity_id, current_user)
    from app.repositories.store_repository import store_repository
    from app.services.store_service import _to_response as store_to_response
    locs = await store_repository.list_all_locations(
        current_user.org_id, entity_type=entity_type, entity_id=entity_id
    )
    return [store_to_response(loc) for loc in locs]


# ── WhatsApp ─────────────────────────────────────────────────────────────────

@router.get(
    "/{entity_type}/{entity_id}/whatsapp/instances",
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_entity_whatsapp_instances(
    entity_type: str,
    entity_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    instances = await whatsapp_service.list_instances(
        property_id=entity_id,
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    return [InstanceResponse.from_doc(i) for i in instances]
