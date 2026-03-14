"""Store location repository — all DB access for store_locations collection."""
from datetime import datetime
from typing import List, Optional

from app.models.store import StoreLocation
from app.utils.datetime import utc_now


class StoreRepository:

    async def list_stores(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> List[StoreLocation]:
        """Return all root stores (depth=0) for a property/entity."""
        filters = [
            StoreLocation.org_id == org_id,
            StoreLocation.location_type == "store",
            StoreLocation.deleted_at == None,  # noqa: E711
        ]
        if entity_type and entity_id:
            filters.append(StoreLocation.entity_type == entity_type)
            filters.append(StoreLocation.entity_id == entity_id)
        elif property_id:
            filters.append(StoreLocation.property_id == property_id)
        return await StoreLocation.find(*filters).sort(StoreLocation.sort_order).to_list()

    async def list_all_locations(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> List[StoreLocation]:
        """Return all locations (all depths) for a property/entity, undeleted."""
        filters = [
            StoreLocation.org_id == org_id,
            StoreLocation.deleted_at == None,  # noqa: E711
        ]
        if entity_type and entity_id:
            filters.append(StoreLocation.entity_type == entity_type)
            filters.append(StoreLocation.entity_id == entity_id)
        elif property_id:
            filters.append(StoreLocation.property_id == property_id)
        return await StoreLocation.find(*filters).sort(StoreLocation.sort_order).to_list()

    async def list_children(self, org_id: str, parent_id: str) -> List[StoreLocation]:
        return await StoreLocation.find(
            StoreLocation.org_id == org_id,
            StoreLocation.parent_id == parent_id,
            StoreLocation.deleted_at == None,  # noqa: E711
        ).sort(StoreLocation.sort_order).to_list()

    async def list_by_store(self, org_id: str, store_id: str) -> List[StoreLocation]:
        """All child locations under a root store."""
        return await StoreLocation.find(
            StoreLocation.org_id == org_id,
            StoreLocation.store_id == store_id,
            StoreLocation.deleted_at == None,  # noqa: E711
        ).sort(StoreLocation.sort_order).to_list()

    async def get_by_id(self, org_id: str, location_id: str) -> Optional[StoreLocation]:
        loc = await StoreLocation.get(location_id)
        if not loc or loc.org_id != org_id or loc.deleted_at is not None:
            return None
        return loc

    async def create(self, data: dict) -> StoreLocation:
        loc = StoreLocation(**data)
        await loc.insert()
        return loc

    async def update(self, loc: StoreLocation, updates: dict) -> StoreLocation:
        updates["updated_at"] = utc_now()
        await loc.set(updates)
        return loc

    async def soft_delete(self, loc: StoreLocation) -> None:
        await loc.set({"deleted_at": utc_now(), "updated_at": utc_now()})

    async def count_siblings(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        parent_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> int:
        """Count active locations under the same parent (used for auto-code generation)."""
        if parent_id is None:
            filters = [
                StoreLocation.org_id == org_id,
                StoreLocation.location_type == "store",
                StoreLocation.deleted_at == None,  # noqa: E711
            ]
            if entity_type and entity_id:
                filters.append(StoreLocation.entity_type == entity_type)
                filters.append(StoreLocation.entity_id == entity_id)
            elif property_id:
                filters.append(StoreLocation.property_id == property_id)
            return await StoreLocation.find(*filters).count()
        return await StoreLocation.find(
            StoreLocation.org_id == org_id,
            StoreLocation.parent_id == parent_id,
            StoreLocation.deleted_at == None,  # noqa: E711
        ).count()

    async def update_occupancy(self, org_id: str, location_id: str, delta: float) -> None:
        """Increment/decrement occupancy and recompute occupancy_pct."""
        loc = await self.get_by_id(org_id, location_id)
        if not loc:
            return
        new_occ = max(0.0, round(loc.current_occupancy + delta, 6))
        new_pct = round(new_occ / loc.capacity_value * 100, 2) if loc.capacity_value else 0.0
        await loc.set({
            "current_occupancy": new_occ,
            "occupancy_pct": new_pct,
            "updated_at": utc_now(),
        })


store_repository = StoreRepository()
