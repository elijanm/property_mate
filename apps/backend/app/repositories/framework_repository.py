from __future__ import annotations

import math
from datetime import datetime, date
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.framework import (
    FrameworkContract,
    FrameworkAsset,
    MaintenanceSchedule,
    WorkOrder,
    SlaRecord,
    SparePartsPricing,
    SparePartsKit,
    TransportCostEntry,
    RateSchedule,
)


# ── Framework Contract Repository ─────────────────────────────────────────────

class FrameworkContractRepository:

    async def create(self, doc: FrameworkContract) -> FrameworkContract:
        await doc.insert()
        return doc

    async def get_by_id(self, org_id: str, framework_id: str) -> Optional[FrameworkContract]:
        return await FrameworkContract.find_one(
            FrameworkContract.id == PydanticObjectId(framework_id),
            FrameworkContract.org_id == org_id,
            FrameworkContract.deleted_at == None,
        )

    async def list(self, org_id: str) -> List[FrameworkContract]:
        return await FrameworkContract.find(
            FrameworkContract.org_id == org_id,
            FrameworkContract.deleted_at == None,
        ).sort(-FrameworkContract.created_at).to_list()

    async def update(self, framework: FrameworkContract) -> FrameworkContract:
        framework.updated_at = datetime.utcnow()
        await framework.save()
        return framework

    async def soft_delete(self, framework: FrameworkContract) -> FrameworkContract:
        framework.deleted_at = datetime.utcnow()
        await framework.save()
        return framework

    async def count_by_contract_number(self, org_id: str, contract_number: str) -> int:
        return await FrameworkContract.find(
            FrameworkContract.org_id == org_id,
            FrameworkContract.contract_number == contract_number,
            FrameworkContract.deleted_at == None,
        ).count()


# ── Framework Asset Repository ────────────────────────────────────────────────

class FrameworkAssetRepository:

    async def create(self, doc: FrameworkAsset) -> FrameworkAsset:
        await doc.insert()
        return doc

    async def get_by_id(self, org_id: str, asset_id: str) -> Optional[FrameworkAsset]:
        return await FrameworkAsset.find_one(
            FrameworkAsset.id == PydanticObjectId(asset_id),
            FrameworkAsset.org_id == org_id,
            FrameworkAsset.deleted_at == None,
        )

    async def list(
        self,
        org_id: str,
        framework_id: str,
        search: Optional[str] = None,
        status: Optional[str] = None,
        kva_rating: Optional[str] = None,
        region: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[FrameworkAsset], int]:
        filters = [
            FrameworkAsset.org_id == org_id,
            FrameworkAsset.framework_id == framework_id,
            FrameworkAsset.deleted_at == None,
        ]
        if status:
            filters.append(FrameworkAsset.operational_status == status)
        if kva_rating:
            filters.append(FrameworkAsset.kva_rating == kva_rating)
        if region:
            filters.append(FrameworkAsset.region == region)

        query = FrameworkAsset.find(*filters)

        if search:
            import re
            pat = re.compile(search, re.IGNORECASE)
            query = FrameworkAsset.find(
                *filters,
                {"$or": [
                    {"site_name": {"$regex": pat.pattern, "$options": "i"}},
                    {"serial_number": {"$regex": pat.pattern, "$options": "i"}},
                    {"asset_tag": {"$regex": pat.pattern, "$options": "i"}},
                    {"site_code": {"$regex": pat.pattern, "$options": "i"}},
                ]},
            )

        total = await query.count()
        items = await query.sort(-FrameworkAsset.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def count_by_status(self, org_id: str, framework_id: str) -> dict:
        pipeline = [
            {"$match": {"org_id": org_id, "framework_id": framework_id, "deleted_at": None}},
            {"$group": {"_id": "$operational_status", "count": {"$sum": 1}}},
        ]
        results = await FrameworkAsset.get_motor_collection().aggregate(pipeline).to_list(length=None)
        return {r["_id"]: r["count"] for r in results}

    async def update(self, asset: FrameworkAsset) -> FrameworkAsset:
        asset.updated_at = datetime.utcnow()
        await asset.save()
        return asset

    async def soft_delete(self, asset: FrameworkAsset) -> FrameworkAsset:
        asset.deleted_at = datetime.utcnow()
        await asset.save()
        return asset

    async def count_by_framework(self, org_id: str, framework_id: str) -> int:
        return await FrameworkAsset.find(
            FrameworkAsset.org_id == org_id,
            FrameworkAsset.framework_id == framework_id,
            FrameworkAsset.deleted_at == None,
        ).count()

    async def count_by_site_code(self, org_id: str, framework_id: str, site_code: str) -> int:
        return await FrameworkAsset.find(
            FrameworkAsset.org_id == org_id,
            FrameworkAsset.framework_id == framework_id,
            FrameworkAsset.site_code == site_code,
            FrameworkAsset.deleted_at == None,
        ).count()


# ── Maintenance Schedule Repository ──────────────────────────────────────────

class MaintenanceScheduleRepository:

    async def create(self, doc: MaintenanceSchedule) -> MaintenanceSchedule:
        await doc.insert()
        return doc

    async def get_by_id(self, org_id: str, schedule_id: str) -> Optional[MaintenanceSchedule]:
        return await MaintenanceSchedule.find_one(
            MaintenanceSchedule.id == PydanticObjectId(schedule_id),
            MaintenanceSchedule.org_id == org_id,
            MaintenanceSchedule.deleted_at == None,
        )

    async def list(
        self,
        org_id: str,
        framework_id: str,
        month: Optional[str] = None,
        status: Optional[str] = None,
        asset_id: Optional[str] = None,
    ) -> List[MaintenanceSchedule]:
        filters: list = [
            MaintenanceSchedule.org_id == org_id,
            MaintenanceSchedule.framework_id == framework_id,
            MaintenanceSchedule.deleted_at == None,
        ]
        if status:
            filters.append(MaintenanceSchedule.status == status)
        if asset_id:
            filters.append(MaintenanceSchedule.asset_id == asset_id)
        if month:
            filters.append({"scheduled_date": {"$regex": f"^{month}"}})

        return await MaintenanceSchedule.find(*filters).sort(MaintenanceSchedule.scheduled_date).to_list()

    async def count_overdue(self, org_id: str, framework_id: str) -> int:
        today = date.today().isoformat()
        return await MaintenanceSchedule.find(
            MaintenanceSchedule.org_id == org_id,
            MaintenanceSchedule.framework_id == framework_id,
            MaintenanceSchedule.deleted_at == None,
            {"status": {"$in": ["pending", "scheduled"]}},
            {"scheduled_date": {"$lt": today}},
        ).count()

    async def update(self, schedule: MaintenanceSchedule) -> MaintenanceSchedule:
        schedule.updated_at = datetime.utcnow()
        await schedule.save()
        return schedule


# ── Work Order Repository ─────────────────────────────────────────────────────

class WorkOrderRepository:

    async def create(self, doc: WorkOrder) -> WorkOrder:
        await doc.insert()
        return doc

    async def get_by_id(self, org_id: str, work_order_id: str) -> Optional[WorkOrder]:
        return await WorkOrder.find_one(
            WorkOrder.id == PydanticObjectId(work_order_id),
            WorkOrder.org_id == org_id,
            WorkOrder.deleted_at == None,
        )

    async def list(
        self,
        org_id: str,
        framework_id: str,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[WorkOrder], int]:
        filters = [
            WorkOrder.org_id == org_id,
            WorkOrder.framework_id == framework_id,
            WorkOrder.deleted_at == None,
        ]
        if status:
            filters.append(WorkOrder.status == status)

        query = WorkOrder.find(*filters)
        total = await query.count()
        items = await query.sort(-WorkOrder.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def count_open(self, org_id: str, framework_id: str) -> int:
        return await WorkOrder.find(
            WorkOrder.org_id == org_id,
            WorkOrder.framework_id == framework_id,
            WorkOrder.deleted_at == None,
            {"status": {"$in": ["draft", "assigned", "en_route", "in_progress"]}},
        ).count()

    async def next_work_order_number(self, org_id: str) -> str:
        count = await WorkOrder.find(WorkOrder.org_id == org_id).count()
        return f"WO-{str(count + 1).zfill(5)}"

    async def update(self, wo: WorkOrder) -> WorkOrder:
        wo.updated_at = datetime.utcnow()
        await wo.save()
        return wo


# ── SLA Record Repository ─────────────────────────────────────────────────────

class SlaRecordRepository:

    async def create(self, doc: SlaRecord) -> SlaRecord:
        await doc.insert()
        return doc

    async def list(
        self,
        org_id: str,
        framework_id: str,
        period: Optional[str] = None,
        asset_id: Optional[str] = None,
    ) -> List[SlaRecord]:
        filters = [
            SlaRecord.org_id == org_id,
            SlaRecord.framework_id == framework_id,
            SlaRecord.deleted_at == None,
        ]
        if period:
            filters.append(SlaRecord.period_quarter == period)
        if asset_id:
            filters.append(SlaRecord.asset_id == asset_id)
        return await SlaRecord.find(*filters).to_list()


# ── Spare Parts Pricing Repository ────────────────────────────────────────────

class SparePartsPricingRepository:

    async def create(self, doc: SparePartsPricing) -> SparePartsPricing:
        await doc.insert()
        return doc

    async def list(self, org_id: str, framework_id: str) -> List[SparePartsPricing]:
        return await SparePartsPricing.find(
            SparePartsPricing.org_id == org_id,
            SparePartsPricing.framework_id == framework_id,
            SparePartsPricing.deleted_at == None,
        ).sort(SparePartsPricing.part_name).to_list()


# ── Transport Cost Repository ─────────────────────────────────────────────────

class TransportCostRepository:

    async def create(self, doc: TransportCostEntry) -> TransportCostEntry:
        await doc.insert()
        return doc

    async def list(self, org_id: str, framework_id: str) -> List[TransportCostEntry]:
        return await TransportCostEntry.find(
            TransportCostEntry.org_id == org_id,
            TransportCostEntry.framework_id == framework_id,
            TransportCostEntry.deleted_at == None,
        ).to_list()


# ── Spare Parts Kit Repository ────────────────────────────────────────────────

class SparePartsKitRepository:

    async def create(self, doc: SparePartsKit) -> SparePartsKit:
        await doc.insert()
        return doc

    async def get_by_id(self, org_id: str, kit_id: str) -> Optional[SparePartsKit]:
        return await SparePartsKit.find_one(
            SparePartsKit.id == PydanticObjectId(kit_id),
            SparePartsKit.org_id == org_id,
            SparePartsKit.deleted_at == None,
        )

    async def list(self, org_id: str, framework_id: str) -> List[SparePartsKit]:
        return await SparePartsKit.find(
            SparePartsKit.org_id == org_id,
            SparePartsKit.framework_id == framework_id,
            SparePartsKit.deleted_at == None,
        ).sort(SparePartsKit.kit_name).to_list()

    async def update(self, kit: SparePartsKit) -> SparePartsKit:
        kit.updated_at = datetime.utcnow()
        await kit.save()
        return kit

    async def soft_delete(self, kit: SparePartsKit) -> SparePartsKit:
        kit.deleted_at = datetime.utcnow()
        await kit.save()
        return kit


# ── Rate Schedule Repository ──────────────────────────────────────────────────

class RateScheduleRepository:

    async def get_by_tier(self, org_id: str, framework_id: str, tier: str) -> Optional[RateSchedule]:
        return await RateSchedule.find_one(
            RateSchedule.org_id == org_id,
            RateSchedule.framework_id == framework_id,
            RateSchedule.pricing_tier == tier,
            RateSchedule.deleted_at == None,
        )

    async def list(self, org_id: str, framework_id: str) -> List[RateSchedule]:
        return await RateSchedule.find(
            RateSchedule.org_id == org_id,
            RateSchedule.framework_id == framework_id,
            RateSchedule.deleted_at == None,
        ).sort(RateSchedule.pricing_tier).to_list()

    async def upsert(self, org_id: str, framework_id: str, tier: str, doc: RateSchedule) -> RateSchedule:
        existing = await self.get_by_tier(org_id, framework_id, tier)
        if existing:
            existing.effective_date = doc.effective_date
            existing.expiry_date = doc.expiry_date
            existing.is_active = doc.is_active
            existing.labour_rates = doc.labour_rates
            existing.accommodation_rates = doc.accommodation_rates
            existing.personnel_transport_rates = doc.personnel_transport_rates
            existing.generator_transport_rates = doc.generator_transport_rates
            existing.site_overrides = doc.site_overrides
            existing.notes = doc.notes
            existing.updated_at = datetime.utcnow()
            await existing.save()
            return existing
        await doc.insert()
        return doc


# ── Singletons ────────────────────────────────────────────────────────────────

framework_repo = FrameworkContractRepository()
framework_asset_repo = FrameworkAssetRepository()
schedule_repo = MaintenanceScheduleRepository()
work_order_repo = WorkOrderRepository()
sla_repo = SlaRecordRepository()
spare_parts_repo = SparePartsPricingRepository()
spare_parts_kit_repo = SparePartsKitRepository()
transport_cost_repo = TransportCostRepository()
rate_schedule_repo = RateScheduleRepository()
