from typing import Dict, List, Optional, Tuple

from app.models.property import Property
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class PropertyRepository:
    async def create(self, prop: Property) -> Property:
        await prop.insert()
        return prop

    async def get_by_id(self, property_id: str, org_id: str) -> Optional[Property]:
        return await Property.find_one(
            Property.id == PydanticObjectId(property_id),
            Property.org_id == org_id,
            Property.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> Tuple[List[Property], int]:
        filters = [Property.org_id == org_id, Property.deleted_at == None]  # noqa: E711
        if status:
            filters.append(Property.status == status)
        print(filters)
        query = Property.find(*filters)
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def update(self, property_id: str, org_id: str, updates: Dict) -> Optional[Property]:
        prop = await self.get_by_id(property_id, org_id)
        if not prop:
            return None
        updates["updated_at"] = utc_now()
        await prop.update({"$set": updates})
        return await self.get_by_id(property_id, org_id)

    async def update_unit_count(self, property_id: str, org_id: str, count: int) -> None:
        prop = await self.get_by_id(property_id, org_id)
        if prop:
            prop.unit_count = count
            await prop.save()


property_repository = PropertyRepository()
