"""Store / warehouse location business logic."""
from typing import List

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.models.store import StoreLocation
from app.repositories.store_repository import store_repository
from app.repositories.property_repository import property_repository
from app.schemas.store import (
    StoreCapacitySummary,
    StoreConfigUpdateRequest,
    StoreCreateRequest,
    StoreListResponse,
    StoreLocationCreateRequest,
    StoreLocationResponse,
    StoreLocationUpdateRequest,
)
from app.utils.datetime import utc_now


# ── Helpers ───────────────────────────────────────────────────────────────────

_TYPE_ORDER = {"store": 0, "zone": 1, "aisle": 2, "rack": 3, "bay": 4, "level": 5, "bin": 6}
_CHILD_TYPES = {0: "zone", 1: "aisle", 2: "rack", 3: "bay", 4: "level", 5: "bin"}
_TYPE_PREFIX = {"store": "WH", "zone": "Z", "aisle": "A", "rack": "R", "bay": "B", "level": "L", "bin": "BIN"}


async def _auto_code(org_id: str, property_id: str, location_type: str, parent_id: str | None) -> str:
    """Generate next sequential code for a location type under the given parent."""
    n = await store_repository.count_siblings(org_id, property_id, parent_id)
    prefix = _TYPE_PREFIX.get(location_type, "LOC")
    return f"{prefix}-{n + 1}"


def _to_response(loc: StoreLocation, children: List['StoreLocationResponse'] = None) -> StoreLocationResponse:
    return StoreLocationResponse(
        id=str(loc.id),
        org_id=loc.org_id,
        property_id=loc.property_id,
        name=loc.name,
        code=loc.code,
        label=loc.label,
        description=loc.description,
        location_type=loc.location_type,
        parent_id=loc.parent_id,
        store_id=loc.store_id,
        path=loc.path,
        depth=loc.depth,
        sort_order=loc.sort_order,
        capacity_value=loc.capacity_value,
        capacity_unit=loc.capacity_unit,
        current_occupancy=loc.current_occupancy,
        occupancy_pct=loc.occupancy_pct,
        assigned_officer_id=loc.assigned_officer_id,
        assigned_officer_name=loc.assigned_officer_name,
        attributes=loc.attributes,
        status=loc.status,
        created_at=loc.created_at,
        updated_at=loc.updated_at,
        children=children or [],
    )


def _build_tree(all_locs: List[StoreLocation], store_id: str) -> List[StoreLocationResponse]:
    """Build nested response tree from a flat list of locations."""
    by_id = {str(loc.id): loc for loc in all_locs}
    children_map: dict[str, list] = {str(loc.id): [] for loc in all_locs}

    roots: list[StoreLocation] = []
    for loc in sorted(all_locs, key=lambda l: l.sort_order):
        if loc.parent_id and loc.parent_id in children_map:
            children_map[loc.parent_id].append(loc)
        elif loc.location_type == "store":
            roots.append(loc)

    def _recurse(loc: StoreLocation) -> StoreLocationResponse:
        child_responses = [_recurse(c) for c in sorted(children_map.get(str(loc.id), []), key=lambda l: l.sort_order)]
        return _to_response(loc, child_responses)

    return [_recurse(r) for r in roots]


async def _get_property(property_id: str, current_user: CurrentUser):
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise HTTPException(status_code=404, detail={"code": "PROPERTY_NOT_FOUND", "message": "Property not found"})
    return prop


# ── Store CRUD ────────────────────────────────────────────────────────────────

async def list_all_locations(property_id: str, current_user: CurrentUser) -> List[StoreLocationResponse]:
    """Return flat list of all store locations for a property (for pickers)."""
    await _get_property(property_id, current_user)
    locs = await store_repository.list_all_locations(current_user.org_id, property_id)
    return [_to_response(loc) for loc in locs]


async def list_stores(property_id: str, current_user: CurrentUser) -> StoreListResponse:
    await _get_property(property_id, current_user)
    stores = await store_repository.list_stores(current_user.org_id, property_id)
    return StoreListResponse(
        stores=[_to_response(s) for s in stores],
        total=len(stores),
    )


async def get_store_tree(property_id: str, store_id: str, current_user: CurrentUser) -> StoreLocationResponse:
    await _get_property(property_id, current_user)
    store = await store_repository.get_by_id(current_user.org_id, store_id)
    if not store or store.property_id != property_id:
        raise HTTPException(status_code=404, detail={"code": "STORE_NOT_FOUND", "message": "Store not found"})

    # Get all child locations + the store itself
    children = await store_repository.list_by_store(current_user.org_id, store_id)
    all_locs = [store] + children
    trees = _build_tree(all_locs, store_id)
    return trees[0] if trees else _to_response(store)


async def create_store(property_id: str, req: StoreCreateRequest, current_user: CurrentUser) -> StoreLocationResponse:
    await _get_property(property_id, current_user)
    code = req.code or await _auto_code(current_user.org_id, property_id, "store", None)
    loc = await store_repository.create({
        "org_id": current_user.org_id,
        "property_id": property_id,
        "name": req.name,
        "code": code,
        "label": req.label,
        "description": req.description,
        "location_type": "store",
        "parent_id": None,
        "store_id": None,      # set below after insert
        "path": req.name,
        "depth": 0,
        "sort_order": req.sort_order,
        "capacity_value": req.capacity_value,
        "capacity_unit": req.capacity_unit,
        "assigned_officer_id": req.assigned_officer_id,
        "assigned_officer_name": req.assigned_officer_name,
        "attributes": req.attributes,
        "status": "active",
    })
    # store_id references itself for root stores
    await store_repository.update(loc, {"store_id": str(loc.id)})
    loc.store_id = str(loc.id)
    return _to_response(loc)


async def update_location(
    property_id: str, location_id: str, req: StoreLocationUpdateRequest, current_user: CurrentUser
) -> StoreLocationResponse:
    await _get_property(property_id, current_user)
    loc = await store_repository.get_by_id(current_user.org_id, location_id)
    if not loc or loc.property_id != property_id:
        raise HTTPException(status_code=404, detail={"code": "LOCATION_NOT_FOUND", "message": "Location not found"})

    updates = req.model_dump(exclude_none=True)
    # Rebuild path if name changed
    if "name" in updates and loc.parent_id:
        parent = await store_repository.get_by_id(current_user.org_id, loc.parent_id)
        if parent:
            updates["path"] = f"{parent.path} / {updates['name']}"
    elif "name" in updates and loc.location_type == "store":
        updates["path"] = updates["name"]

    await store_repository.update(loc, updates)
    for k, v in updates.items():
        setattr(loc, k, v)
    return _to_response(loc)


async def delete_location(property_id: str, location_id: str, current_user: CurrentUser) -> None:
    await _get_property(property_id, current_user)
    loc = await store_repository.get_by_id(current_user.org_id, location_id)
    if not loc or loc.property_id != property_id:
        raise HTTPException(status_code=404, detail={"code": "LOCATION_NOT_FOUND", "message": "Location not found"})
    await store_repository.soft_delete(loc)


# ── Child location (aisle / bay / face) ───────────────────────────────────────

async def create_child_location(
    property_id: str, store_id: str, req: StoreLocationCreateRequest, current_user: CurrentUser
) -> StoreLocationResponse:
    await _get_property(property_id, current_user)

    # Validate store exists
    store = await store_repository.get_by_id(current_user.org_id, store_id)
    if not store or store.property_id != property_id:
        raise HTTPException(status_code=404, detail={"code": "STORE_NOT_FOUND", "message": "Store not found"})

    # Determine parent
    parent_id = req.parent_id or store_id
    parent = await store_repository.get_by_id(current_user.org_id, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail={"code": "PARENT_NOT_FOUND", "message": "Parent location not found"})

    depth = parent.depth + 1
    if depth > 6:
        raise HTTPException(status_code=400, detail={"code": "MAX_DEPTH_EXCEEDED", "message": "Maximum segmentation depth is bin (depth 6)"})

    code = req.code or await _auto_code(current_user.org_id, property_id, req.location_type, parent_id)
    path = f"{parent.path} / {req.name}"

    loc = await store_repository.create({
        "org_id": current_user.org_id,
        "property_id": property_id,
        "name": req.name,
        "code": code,
        "label": req.label,
        "description": req.description,
        "location_type": req.location_type,
        "parent_id": parent_id,
        "store_id": store_id,
        "path": path,
        "depth": depth,
        "sort_order": req.sort_order,
        "capacity_value": req.capacity_value,
        "capacity_unit": req.capacity_unit or store.capacity_unit,
        "assigned_officer_id": req.assigned_officer_id,
        "assigned_officer_name": req.assigned_officer_name,
        "attributes": req.attributes,
        "status": "active",
    })
    return _to_response(loc)


# ── Store config ──────────────────────────────────────────────────────────────

async def update_store_config(
    property_id: str, req: StoreConfigUpdateRequest, current_user: CurrentUser
) -> dict:
    prop = await _get_property(property_id, current_user)
    cfg = prop.store_config
    updates = req.model_dump(exclude_none=True)
    for k, v in updates.items():
        setattr(cfg, k, v)
    await property_repository.update_property(property_id, current_user.org_id, {"store_config": cfg.model_dump()})
    return cfg.model_dump()


# ── Capacity summary ──────────────────────────────────────────────────────────

async def get_capacity_summary(property_id: str, store_id: str, current_user: CurrentUser) -> List[StoreCapacitySummary]:
    await _get_property(property_id, current_user)
    store = await store_repository.get_by_id(current_user.org_id, store_id)
    if not store or store.property_id != property_id:
        raise HTTPException(status_code=404, detail={"code": "STORE_NOT_FOUND", "message": "Store not found"})
    children = await store_repository.list_by_store(current_user.org_id, store_id)
    all_locs = [store] + children
    return [
        StoreCapacitySummary(
            location_id=str(loc.id),
            location_name=loc.name,
            path=loc.path,
            capacity_value=loc.capacity_value,
            capacity_unit=loc.capacity_unit,
            current_occupancy=loc.current_occupancy,
            occupancy_pct=loc.occupancy_pct,
            status=loc.status,
        )
        for loc in all_locs if loc.capacity_value is not None
    ]
