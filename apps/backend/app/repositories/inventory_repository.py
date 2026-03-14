"""Inventory repository — all DB access for the InventoryItem and StockShipment collections."""
from datetime import date
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.inventory import InventoryItem
from app.models.stock_shipment import StockShipment
from app.core.database import get_motor_db
from app.utils.datetime import utc_now


class InventoryRepository:
    async def create(self, item: InventoryItem) -> InventoryItem:
        await item.insert()
        return item

    async def get_by_id(self, item_id: str, org_id: str) -> Optional[InventoryItem]:
        return await InventoryItem.find_one(
            InventoryItem.id == PydanticObjectId(item_id),
            InventoryItem.org_id == org_id,
            InventoryItem.deleted_at == None,  # noqa: E711
        )

    async def get_by_item_id(self, item_id: str, org_id: str) -> Optional[InventoryItem]:
        """Find by human-readable INV-XXXXXX id."""
        return await InventoryItem.find_one(
            InventoryItem.item_id == item_id,
            InventoryItem.org_id == org_id,
            InventoryItem.deleted_at == None,  # noqa: E711
        )

    async def get_by_barcode(self, barcode: str, org_id: str) -> Optional[InventoryItem]:
        return await InventoryItem.find_one(
            InventoryItem.barcode == barcode,
            InventoryItem.org_id == org_id,
            InventoryItem.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        low_stock_only: bool = False,
        hazard_class: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[InventoryItem], int]:
        filters = [
            InventoryItem.org_id == org_id,
            InventoryItem.deleted_at == None,  # noqa: E711
        ]
        if entity_type and entity_id:
            filters.append(InventoryItem.entity_type == entity_type)
            filters.append(InventoryItem.entity_id == entity_id)
        elif property_id:
            filters.append(InventoryItem.property_id == property_id)
        if category:
            filters.append(InventoryItem.category == category)
        if status:
            filters.append(InventoryItem.status == status)

        query = InventoryItem.find(*filters)

        extra: dict = {}
        if low_stock_only:
            extra["$expr"] = {"$lte": ["$total_available", "$reorder_point"]}
        if hazard_class:
            extra["hazard_classes"] = hazard_class
        if search:
            extra["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"item_id": {"$regex": search, "$options": "i"}},
                {"sku": {"$regex": search, "$options": "i"}},
                {"barcode": {"$regex": search, "$options": "i"}},
            ]

        if extra:
            query = InventoryItem.find(*filters, extra)

        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.sort(-InventoryItem.created_at).skip(skip).limit(page_size).to_list()
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

        today = date.today().isoformat()
        soon = date.today().replace(day=min(date.today().day + 30, 28)).isoformat()

        pipeline = [
            {"$match": filters},
            {"$facet": {
                "total": [{"$count": "n"}],
                "active": [{"$match": {"status": "active"}}, {"$count": "n"}],
                "low_stock": [
                    {"$match": {"$expr": {"$lte": ["$total_available", "$reorder_point"]}}},
                    {"$count": "n"},
                ],
                "out_of_stock": [{"$match": {"total_available": {"$lte": 0}}}, {"$count": "n"}],
                "expiring_soon": [
                    {"$match": {"batches": {"$elemMatch": {
                        "expiry_date": {"$gte": today, "$lte": soon},
                        "quantity_remaining": {"$gt": 0},
                    }}}},
                    {"$count": "n"},
                ],
            }},
        ]
        col = get_motor_db()["inventory_items"]
        async for doc in col.aggregate(pipeline):
            def _n(key: str) -> int:
                val = doc.get(key, [])
                return val[0]["n"] if val else 0
            return {
                "total": _n("total"),
                "active": _n("active"),
                "low_stock": _n("low_stock"),
                "out_of_stock": _n("out_of_stock"),
                "expiring_soon": _n("expiring_soon"),
            }
        return {"total": 0, "active": 0, "low_stock": 0, "out_of_stock": 0, "expiring_soon": 0}

    async def update(self, item: InventoryItem, fields: dict) -> InventoryItem:
        fields["updated_at"] = utc_now()
        await item.set(fields)
        return item

    async def soft_delete(self, item: InventoryItem) -> None:
        await item.set({"deleted_at": utc_now()})

    async def next_item_id(self, org_id: str) -> str:
        """Generate next human-readable INV-XXXXXX id using atomic counter on Org."""
        org_col = get_motor_db()["orgs"]
        result = await org_col.find_one_and_update(
            # {"_id": PydanticObjectId(org_id)},
            {"org_id":org_id},
            {"$inc": {"inventory_counter": 1}},
            return_document=True,
            upsert=False,
        )
        counter = result.get("inventory_counter", 1) if result else 1
        return f"INV-{counter:06d}"


inventory_repository = InventoryRepository()


class ShipmentRepository:
    async def create(self, shipment: StockShipment) -> StockShipment:
        await shipment.insert()
        return shipment

    async def get_by_id(self, shipment_id: str, org_id: str) -> Optional[StockShipment]:
        try:
            oid = PydanticObjectId(shipment_id)
        except Exception:
            return None
        return await StockShipment.find_one(
            StockShipment.id == oid,
            StockShipment.org_id == org_id,
            StockShipment.deleted_at == None,  # noqa: E711
        )

    async def get_by_driver_token(self, token: str) -> Optional[StockShipment]:
        return await StockShipment.find_one(
            StockShipment.driver_sign_token == token,
            StockShipment.deleted_at == None,  # noqa: E711
        )

    async def get_by_receiver_token(self, token: str) -> Optional[StockShipment]:
        return await StockShipment.find_one(
            StockShipment.receiver_sign_token == token,
            StockShipment.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[StockShipment], int]:
        filters = [
            StockShipment.org_id == org_id,
            StockShipment.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(StockShipment.status == status)
        query = StockShipment.find(*filters)
        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.sort(-StockShipment.created_at).skip(skip).limit(page_size).to_list()
        return items, total

    async def update(self, shipment: StockShipment, fields: dict) -> StockShipment:
        fields["updated_at"] = utc_now()
        await shipment.set(fields)
        return shipment

    async def next_reference_number(self, org_id: str) -> str:
        """Generate next SHP-XXXXXX via atomic counter on Org."""
        org_col = get_motor_db()["orgs"]
        result = await org_col.find_one_and_update(
            {"org_id": org_id},
            {"$inc": {"shipment_counter": 1}},
            return_document=True,
            upsert=False,
        )
        counter = result.get("shipment_counter", 1) if result else 1
        return f"SHP-{counter:06d}"


shipment_repository = ShipmentRepository()
