"""Asset repository — all DB access for the Asset collection."""
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.asset import Asset
from app.core.database import get_motor_db
from app.utils.datetime import utc_now


class AssetRepository:
    async def create(self, asset: Asset) -> Asset:
        await asset.insert()
        return asset

    async def get_by_id(self, asset_id: str, org_id: str) -> Optional[Asset]:
        return await Asset.find_one(
            Asset.id == PydanticObjectId(asset_id),
            Asset.org_id == org_id,
            Asset.deleted_at == None,  # noqa: E711
        )

    async def get_by_asset_id(self, asset_id: str, org_id: str) -> Optional[Asset]:
        """Find by human-readable ASSET-XXXXXX id."""
        return await Asset.find_one(
            Asset.asset_id == asset_id,
            Asset.org_id == org_id,
            Asset.deleted_at == None,  # noqa: E711
        )

    async def get_by_barcode(self, barcode: str, org_id: str) -> Optional[Asset]:
        return await Asset.find_one(
            Asset.barcode == barcode,
            Asset.org_id == org_id,
            Asset.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        unit_id: Optional[str] = None,
        category: Optional[str] = None,
        lifecycle_status: Optional[str] = None,
        condition: Optional[str] = None,
        assigned_to: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Asset], int]:
        filters = [
            Asset.org_id == org_id,
            Asset.deleted_at == None,  # noqa: E711
        ]
        if entity_type and entity_id:
            filters.append(Asset.entity_type == entity_type)
            filters.append(Asset.entity_id == entity_id)
        elif property_id:
            filters.append(Asset.property_id == property_id)
        if unit_id:
            filters.append(Asset.unit_id == unit_id)
        if category:
            filters.append(Asset.category == category)
        if lifecycle_status:
            filters.append(Asset.lifecycle_status == lifecycle_status)
        if condition:
            filters.append(Asset.condition == condition)
        if assigned_to:
            filters.append(Asset.assigned_to == assigned_to)

        query = Asset.find(*filters)

        if search:
            # Text search on name/asset_id/serial_number
            query = Asset.find(
                *filters,
                {"$or": [
                    {"name": {"$regex": search, "$options": "i"}},
                    {"asset_id": {"$regex": search, "$options": "i"}},
                    {"serial_number": {"$regex": search, "$options": "i"}},
                    {"barcode": {"$regex": search, "$options": "i"}},
                ]},
            )

        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.sort(-Asset.created_at).skip(skip).limit(page_size).to_list()
        return items, total

    async def count_by_status(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> dict:
        filters: dict = {"org_id": org_id, "deleted_at": None}
        if entity_type and entity_id:
            filters["entity_type"] = entity_type
            filters["entity_id"] = entity_id
        elif property_id:
            filters["property_id"] = property_id

        pipeline = [
            {"$match": filters},
            {"$group": {"_id": "$lifecycle_status", "count": {"$sum": 1}}},
        ]
        col = get_motor_db()["assets"]
        cursor = col.aggregate(pipeline)
        result = {}
        async for doc in cursor:
            result[doc["_id"]] = doc["count"]
        return result

    async def update(self, asset: Asset, fields: dict) -> Asset:
        fields["updated_at"] = utc_now()
        await asset.set(fields)
        return asset

    async def soft_delete(self, asset: Asset) -> None:
        await asset.set({"deleted_at": utc_now()})

    async def next_asset_id(self, org_id: str) -> str:
        """Generate next human-readable ASSET-XXXXXX id using atomic counter on Org."""
        org_col = get_motor_db()["orgs"]
        result = await org_col.find_one_and_update(
            # {"_id": PydanticObjectId(org_id)},
            {"org_id":org_id},
            {"$inc": {"asset_counter": 1}},
            return_document=True,
            upsert=False,
        )
        counter = result.get("asset_counter", 1) if result else 1
        return f"ASSET-{counter:06d}"


asset_repository = AssetRepository()
