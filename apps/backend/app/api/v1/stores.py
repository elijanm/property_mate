"""Store / warehouse location API routes."""
from typing import List

from fastapi import APIRouter, Depends

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.store import (
    StoreCapacitySummary,
    StoreConfigUpdateRequest,
    StoreCreateRequest,
    StoreListResponse,
    StoreLocationCreateRequest,
    StoreLocationResponse,
    StoreLocationUpdateRequest,
)
from app.services import store_service

router = APIRouter(prefix="/properties/{property_id}/stores", tags=["stores"])


@router.get("/locations", response_model=List[StoreLocationResponse])
async def list_all_locations(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    """Flat list of all store locations for a property (for pickers)."""
    return await store_service.list_all_locations(property_id, current_user)


@router.get("", response_model=StoreListResponse)
async def list_stores(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.list_stores(property_id, current_user)


@router.post("", response_model=StoreLocationResponse, status_code=201)
async def create_store(
    property_id: str,
    req: StoreCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.create_store(property_id, req, current_user)


@router.get("/{store_id}/tree", response_model=StoreLocationResponse)
async def get_store_tree(
    property_id: str,
    store_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.get_store_tree(property_id, store_id, current_user)


@router.get("/{store_id}/capacity", response_model=List[StoreCapacitySummary])
async def get_capacity_summary(
    property_id: str,
    store_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.get_capacity_summary(property_id, store_id, current_user)


@router.post("/{store_id}/locations", response_model=StoreLocationResponse, status_code=201)
async def create_child_location(
    property_id: str,
    store_id: str,
    req: StoreLocationCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.create_child_location(property_id, store_id, req, current_user)


@router.patch("/locations/{location_id}", response_model=StoreLocationResponse)
async def update_location(
    property_id: str,
    location_id: str,
    req: StoreLocationUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    return await store_service.update_location(property_id, location_id, req, current_user)


@router.delete("/locations/{location_id}", status_code=204)
async def delete_location(
    property_id: str,
    location_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent")),
):
    await store_service.delete_location(property_id, location_id, current_user)


@router.patch("/config", response_model=dict)
async def update_store_config(
    property_id: str,
    req: StoreConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner")),
):
    return await store_service.update_store_config(property_id, req, current_user)
