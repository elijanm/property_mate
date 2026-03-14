from typing import Any, Dict, List, Optional, Tuple

from app.models.unit import Unit
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class UnitRepository:
    async def create(self, unit: Unit) -> Unit:
        await unit.insert()
        return unit

    async def get_by_id(self, unit_id: str, org_id: str) -> Optional[Unit]:
        return await Unit.find_one(
            Unit.id == PydanticObjectId(unit_id),
            Unit.org_id == org_id,
            Unit.deleted_at == None,  # noqa: E711
        )

    async def get_by_ids(self, unit_ids: list[str], org_id: str) -> list[Unit]:
        if not unit_ids:
            return []
        unit_ids = [PydanticObjectId(uid) for uid in unit_ids]
        
        return await Unit.find(
            {"_id": {"$in": unit_ids}, "org_id": org_id, "deleted_at": None}
        ).to_list()

    async def get_by_code(
        self, unit_code: str, property_id: str, org_id: str
    ) -> Optional[Unit]:
        return await Unit.find_one(
            Unit.unit_code == unit_code,
            Unit.property_id == PydanticObjectId(property_id),
            Unit.org_id == org_id,
            Unit.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        property_id: str,
        org_id: Optional[str] = None,
        status: Optional[str] = None,
        wing: Optional[str] = None,
        floor: Optional[int] = None,
        unit_type: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Unit], int]:
        filters: List[Any] = [
            Unit.property_id == PydanticObjectId(property_id),
            Unit.deleted_at == None,  # noqa: E711
        ]
        if org_id:
           filters.append(Unit.org_id == org_id)
        if status:
            filters.append(Unit.status == status)
        if wing:
            filters.append(Unit.wing == wing)
        if floor is not None:
            filters.append(Unit.floor == floor)
        if unit_type:
            filters.append(Unit.unit_type == unit_type)

        query = Unit.find(*filters).sort("+unit_code")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def update(self, unit: Unit, updates: Dict[str, Any]) -> Unit:
        updates["updated_at"] = utc_now()
        for key, value in updates.items():
            setattr(unit, key, value)
        await unit.save()
        return unit

    async def atomic_status_transition(
        self,
        unit_id: str,
        org_id: str,
        expected_status: str,
        new_status: str,
    ) -> Optional[Unit]:
        """Atomically update status only if current status matches expected. Returns updated unit or None."""
        now = utc_now()
        col = Unit.get_pymongo_collection()
        result = await col.find_one_and_update(
            {
                "_id": PydanticObjectId(unit_id),
                "org_id": org_id,
                "status": expected_status,
                "deleted_at": None,
            },
            {"$set": {"status": new_status, "updated_at": now}},
            return_document=True,
        )
        if result is None:
            return None
        return Unit.model_validate(result)

    async def list_by_org(
        self,
        org_id: str,
        skip: int = 0,
        limit: int = 10000,
    ) -> Tuple[List[Unit], int]:
        """Return all units across all properties for an org."""
        filters: List[Any] = [
            Unit.org_id == org_id,
            Unit.deleted_at == None,  # noqa: E711
        ]
        query = Unit.find(*filters).sort("+unit_code")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def cache_meter_reading(
        self,
        unit_id: str,
        org_id: str,
        utility_key: str,
        value: float,
        read_at,
        read_by: str,
        read_by_name: str,
    ) -> None:
        """Atomically write the latest reading for one utility key into meter_reading_cache."""
        col = Unit.get_pymongo_collection()
        await col.update_one(
            {"_id": PydanticObjectId(unit_id), "org_id": org_id, "deleted_at": None},
            {
                "$set": {
                    f"meter_reading_cache.{utility_key}": {
                        "value": value,
                        "read_at": read_at,
                        "read_by": read_by,
                        "read_by_name": read_by_name,
                    },
                    "updated_at": utc_now(),
                }
            },
        )

    async def soft_delete(self, unit: Unit) -> None:
        unit.deleted_at = utc_now()
        await unit.save()


unit_repository = UnitRepository()
