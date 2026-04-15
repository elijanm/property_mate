from __future__ import annotations

import base64
import io
import math
from datetime import datetime, date
from typing import Any, Dict, List, Optional

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.dependencies.auth import CurrentUser
from app.models.framework import (
    FrameworkContract,
    FrameworkSite,
    FrameworkAsset,
    MaintenanceSchedule,
    WorkOrder,
    SlaRecord,
    SparePartsPricing,
    SparePartsKit,
    SparePartsKitItem,
    TransportCostEntry,
    RateSchedule,
    LabourRateEntry,
    AccommodationRateEntry,
    PersonnelTransportRate,
    GeneratorTransportRate,
    SiteRateOverride,
    RouteStop,
    WorkOrderPart,
    SlaEvent,
    PreInspection,
    PreInspectionItem,
)
from app.repositories.framework_repository import (
    framework_repo,
    framework_asset_repo,
    schedule_repo,
    work_order_repo,
    sla_repo,
    spare_parts_repo,
    spare_parts_kit_repo,
    transport_cost_repo,
    rate_schedule_repo,
)
from app.schemas.framework import (
    FrameworkContractCreateRequest,
    FrameworkContractResponse,
    FrameworkContractUpdateRequest,
    FrameworkAssetCreateRequest,
    FrameworkAssetResponse,
    FrameworkAssetListResponse,
    MaintenanceScheduleCreateRequest,
    MaintenanceScheduleResponse,
    WorkOrderCreateRequest,
    WorkOrderUpdateRequest,
    WorkOrderResponse,
    WorkOrderListResponse,
    GenerateRouteRequest,
    PreInspectionSubmitRequest,
    PreInspectionApproveRequest,
    SlaRecordCreateRequest,
    SlaRecordResponse,
    SparePartsPricingRequest,
    SparePartsPricingResponse,
    FrameworkRegionsSitesRequest,
    Schedule4UpdateRequest,
    SparePartsKitCreateRequest,
    SparePartsKitUpdateRequest,
    SparePartsKitResponse,
    SparePartsKitItemResponse,
    RateScheduleUpsertRequest,
    RateScheduleResponse,
    TransportCostRequest,
    TransportCostResponse,
    FrameworkStatsResponse,
)


# ── Mappers ───────────────────────────────────────────────────────────────────

def _fw_to_response(fw: FrameworkContract) -> FrameworkContractResponse:
    from app.schemas.framework import FrameworkSiteResponse, Schedule4EntryResponse
    return FrameworkContractResponse(
        id=str(fw.id),
        org_id=fw.org_id,
        name=fw.name,
        client_name=fw.client_name,
        contract_number=fw.contract_number,
        contract_start=fw.contract_start,
        contract_end=fw.contract_end,
        region=fw.region,
        description=fw.description,
        status=fw.status,
        color=fw.color,
        regions=fw.regions,
        sites=[FrameworkSiteResponse(**s.model_dump()) for s in fw.sites],
        schedule4_entries=[
            Schedule4EntryResponse(**e.model_dump(), cost_d=e.cost_a + e.cost_b + e.cost_c)
            for e in fw.schedule4_entries
        ],
        total_assets=fw.total_assets,
        active_work_orders=fw.active_work_orders,
        overdue_schedules=fw.overdue_schedules,
        sla_score=fw.sla_score,
        created_at=fw.created_at.isoformat(),
        updated_at=fw.updated_at.isoformat(),
    )


def _asset_to_response(a: FrameworkAsset) -> FrameworkAssetResponse:
    return FrameworkAssetResponse(
        id=str(a.id),
        org_id=a.org_id,
        framework_id=a.framework_id,
        asset_tag=a.asset_tag,
        site_name=a.site_name,
        site_code=a.site_code,
        kva_rating=a.kva_rating,
        engine_make=a.engine_make,
        engine_model=a.engine_model,
        serial_number=a.serial_number,
        manufacture_year=a.manufacture_year,
        fuel_type=a.fuel_type,
        region=a.region,
        physical_address=a.physical_address,
        gps_lat=a.gps_lat,
        gps_lng=a.gps_lng,
        site_contact_name=a.site_contact_name,
        site_contact_phone=a.site_contact_phone,
        operational_status=a.operational_status,
        installation_date=a.installation_date,
        warranty_expiry=a.warranty_expiry,
        service_frequency=a.service_frequency,
        last_service_date=a.last_service_date,
        next_service_date=a.next_service_date,
        last_service_type=a.last_service_type,
        total_runtime_hours=a.total_runtime_hours,
        notes=a.notes,
        created_at=a.created_at.isoformat(),
        updated_at=a.updated_at.isoformat(),
    )


def _schedule_to_response(s: MaintenanceSchedule) -> MaintenanceScheduleResponse:
    return MaintenanceScheduleResponse(
        id=str(s.id),
        org_id=s.org_id,
        framework_id=s.framework_id,
        asset_id=s.asset_id,
        asset_site_name=s.asset_site_name,
        asset_region=s.asset_region,
        service_type=s.service_type,
        scheduled_date=s.scheduled_date,
        status=s.status,
        work_order_id=s.work_order_id,
        assigned_vendor_id=s.assigned_vendor_id,
        assigned_vendor_name=s.assigned_vendor_name,
        estimated_duration_hours=s.estimated_duration_hours,
        notes=s.notes,
        created_at=s.created_at.isoformat(),
    )


def _wo_to_response(wo: WorkOrder) -> WorkOrderResponse:
    return WorkOrderResponse(
        id=str(wo.id),
        org_id=wo.org_id,
        framework_id=wo.framework_id,
        work_order_number=wo.work_order_number,
        title=wo.title,
        service_type=wo.service_type,
        status=wo.status,
        assigned_vendor_id=wo.assigned_vendor_id,
        assigned_vendor_name=wo.assigned_vendor_name,
        technician_names=wo.technician_names,
        route_stops=[s.model_dump() for s in wo.route_stops],
        planned_date=wo.planned_date,
        start_date=wo.start_date,
        completion_date=wo.completion_date,
        total_assets=wo.total_assets,
        parts_used=[p.model_dump() for p in wo.parts_used],
        labor_hours=wo.labor_hours,
        transport_cost=wo.transport_cost,
        accommodation_cost=wo.accommodation_cost,
        total_cost=wo.total_cost,
        pre_inspection=wo.pre_inspection.model_dump() if wo.pre_inspection else None,
        client_signature_url=wo.client_signature_url,
        technician_signature_url=wo.technician_signature_url,
        report_notes=wo.report_notes,
        created_at=wo.created_at.isoformat(),
        updated_at=wo.updated_at.isoformat(),
    )


def _sla_to_response(r: SlaRecord) -> SlaRecordResponse:
    return SlaRecordResponse(
        id=str(r.id),
        org_id=r.org_id,
        framework_id=r.framework_id,
        asset_id=r.asset_id,
        site_name=r.site_name,
        period_quarter=r.period_quarter,
        response_time_hours=r.response_time_hours,
        resolution_time_hours=r.resolution_time_hours,
        sla_level=r.sla_level,
        events=[e.model_dump() for e in r.events],
        penalty_percentage=r.penalty_percentage,
        penalty_amount=r.penalty_amount,
        notes=r.notes,
        created_at=r.created_at.isoformat(),
    )


def _next_asset_tag(framework_id: str, count: int) -> str:
    prefix = framework_id[-4:].upper()
    return f"FA-{prefix}-{str(count + 1).zfill(3)}"


# ── Framework Contract Service ────────────────────────────────────────────────

async def list_frameworks(current_user: CurrentUser) -> List[FrameworkContractResponse]:
    contracts = await framework_repo.list(current_user.org_id)
    return [_fw_to_response(c) for c in contracts]


async def get_framework(current_user: CurrentUser, framework_id: str) -> FrameworkContractResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")
    return _fw_to_response(fw)


async def create_framework(
    current_user: CurrentUser,
    data: FrameworkContractCreateRequest,
) -> FrameworkContractResponse:
    existing = await framework_repo.count_by_contract_number(current_user.org_id, data.contract_number)
    if existing:
        raise ConflictError("A contract with this number already exists")

    fw = FrameworkContract(
        org_id=current_user.org_id,
        name=data.name,
        client_name=data.client_name,
        contract_number=data.contract_number,
        contract_start=data.contract_start,
        contract_end=data.contract_end,
        region=data.region,
        description=data.description,
        status="active",
        color=data.color,
        created_by=current_user.user_id,
    )
    fw = await framework_repo.create(fw)
    return _fw_to_response(fw)


async def update_framework(
    current_user: CurrentUser,
    framework_id: str,
    data: FrameworkContractUpdateRequest,
) -> FrameworkContractResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(fw, field, value)

    fw = await framework_repo.update(fw)
    return _fw_to_response(fw)


async def delete_framework(current_user: CurrentUser, framework_id: str) -> None:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")
    await framework_repo.soft_delete(fw)


# ── Stats Service ─────────────────────────────────────────────────────────────

async def get_framework_stats(
    current_user: CurrentUser,
    framework_id: str,
) -> FrameworkStatsResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    status_counts = await framework_asset_repo.count_by_status(current_user.org_id, framework_id)
    total = sum(status_counts.values())
    overdue = await schedule_repo.count_overdue(current_user.org_id, framework_id)
    open_wos = await work_order_repo.count_open(current_user.org_id, framework_id)

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    from app.models.framework import WorkOrder as WOModel
    completed_this_month = await WOModel.find(
        WOModel.org_id == current_user.org_id,
        WOModel.framework_id == framework_id,
        WOModel.status == "signed_off",
        WOModel.updated_at >= month_start,
        WOModel.deleted_at == None,
    ).count()

    quarter = f"{now.year}-Q{math.ceil(now.month / 3)}"
    sla_records = await sla_repo.list(current_user.org_id, framework_id, period=quarter)
    total_penalties = sum(r.penalty_amount or 0 for r in sla_records)
    avg_sla = 100.0
    if sla_records:
        score_map = {"exceptional": 100, "very_good": 85, "marginal": 60, "unsatisfactory": 35, "defective": 0}
        avg_sla = sum(score_map.get(r.sla_level, 50) for r in sla_records) / len(sla_records)

    return FrameworkStatsResponse(
        total_assets=total,
        operational=status_counts.get("operational", 0),
        under_maintenance=status_counts.get("under_maintenance", 0),
        fault=status_counts.get("fault", 0),
        standby=status_counts.get("standby", 0),
        decommissioned=status_counts.get("decommissioned", 0),
        overdue_schedules=overdue,
        open_work_orders=open_wos,
        completed_this_month=completed_this_month,
        avg_sla_score=round(avg_sla, 1),
        total_penalties_qtd=total_penalties,
    )


# ── Framework Asset Service ───────────────────────────────────────────────────

async def list_framework_assets(
    current_user: CurrentUser,
    framework_id: str,
    search: Optional[str] = None,
    status: Optional[str] = None,
    kva: Optional[str] = None,
    region: Optional[str] = None,
    page: int = 1,
) -> FrameworkAssetListResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    items, total = await framework_asset_repo.list(
        current_user.org_id, framework_id,
        search=search, status=status, kva_rating=kva, region=region,
        page=page, page_size=20,
    )
    return FrameworkAssetListResponse(
        items=[_asset_to_response(a) for a in items],
        total=total, page=page, page_size=20,
    )


async def create_framework_asset(
    current_user: CurrentUser,
    framework_id: str,
    data: FrameworkAssetCreateRequest,
) -> FrameworkAssetResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    if await framework_asset_repo.count_by_site_code(current_user.org_id, framework_id, data.site_code):
        raise ConflictError(f"An asset with site code '{data.site_code}' already exists in this contract")

    count = await framework_asset_repo.count_by_framework(current_user.org_id, framework_id)
    asset_tag = _next_asset_tag(framework_id, count)

    asset = FrameworkAsset(
        org_id=current_user.org_id,
        framework_id=framework_id,
        asset_tag=asset_tag,
        **data.model_dump(),
        created_by=current_user.user_id,
    )
    asset = await framework_asset_repo.create(asset)

    # Update counter
    fw.total_assets = count + 1
    await framework_repo.update(fw)

    return _asset_to_response(asset)


async def update_framework_asset(
    current_user: CurrentUser,
    framework_id: str,
    asset_id: str,
    data,
) -> FrameworkAssetResponse:
    asset = await framework_asset_repo.get_by_id(current_user.org_id, asset_id)
    if not asset or asset.framework_id != framework_id:
        raise ResourceNotFoundError("Asset not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(asset, field, value)

    asset = await framework_asset_repo.update(asset)
    return _asset_to_response(asset)


async def delete_framework_asset(
    current_user: CurrentUser,
    framework_id: str,
    asset_id: str,
) -> None:
    asset = await framework_asset_repo.get_by_id(current_user.org_id, asset_id)
    if not asset or asset.framework_id != framework_id:
        raise ResourceNotFoundError("Asset not found")
    await framework_asset_repo.soft_delete(asset)

    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if fw and fw.total_assets > 0:
        fw.total_assets -= 1
        await framework_repo.update(fw)


# ── Maintenance Schedule Service ──────────────────────────────────────────────

async def list_schedules(
    current_user: CurrentUser,
    framework_id: str,
    month: Optional[str] = None,
    status: Optional[str] = None,
    asset_id: Optional[str] = None,
) -> List[MaintenanceScheduleResponse]:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    items = await schedule_repo.list(current_user.org_id, framework_id, month=month, status=status, asset_id=asset_id)
    return [_schedule_to_response(s) for s in items]


async def create_schedule(
    current_user: CurrentUser,
    framework_id: str,
    data: MaintenanceScheduleCreateRequest,
) -> MaintenanceScheduleResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    # Auto-mark as overdue if scheduled date is in the past
    status = data.status
    if status == "pending" and data.scheduled_date < date.today().isoformat():
        status = "overdue"

    schedule = MaintenanceSchedule(
        org_id=current_user.org_id,
        framework_id=framework_id,
        asset_id=data.asset_id,
        asset_site_name=data.asset_site_name,
        asset_region=data.asset_region,
        service_type=data.service_type,  # type: ignore[arg-type]
        scheduled_date=data.scheduled_date,
        status=status,  # type: ignore[arg-type]
        assigned_vendor_id=data.assigned_vendor_id,
        assigned_vendor_name=data.assigned_vendor_name,
        estimated_duration_hours=data.estimated_duration_hours,
        notes=data.notes,
        created_by=current_user.user_id,
    )
    schedule = await schedule_repo.create(schedule)
    return _schedule_to_response(schedule)


async def update_schedule_status(
    current_user: CurrentUser,
    framework_id: str,
    schedule_id: str,
    status: str,
) -> MaintenanceScheduleResponse:
    schedule = await schedule_repo.get_by_id(current_user.org_id, schedule_id)
    if not schedule or schedule.framework_id != framework_id:
        raise ResourceNotFoundError("Schedule not found")

    schedule.status = status  # type: ignore[assignment]
    schedule = await schedule_repo.update(schedule)
    return _schedule_to_response(schedule)


# ── Work Order Service ────────────────────────────────────────────────────────

async def list_work_orders(
    current_user: CurrentUser,
    framework_id: str,
    status: Optional[str] = None,
    page: int = 1,
) -> WorkOrderListResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    items, total = await work_order_repo.list(current_user.org_id, framework_id, status=status, page=page)
    return WorkOrderListResponse(
        items=[_wo_to_response(wo) for wo in items],
        total=total, page=page, page_size=20,
    )


async def get_work_order(
    current_user: CurrentUser,
    framework_id: str,
    work_order_id: str,
) -> WorkOrderResponse:
    wo = await work_order_repo.get_by_id(current_user.org_id, work_order_id)
    if not wo or wo.framework_id != framework_id:
        raise ResourceNotFoundError("Work order not found")
    return _wo_to_response(wo)


async def create_work_order(
    current_user: CurrentUser,
    framework_id: str,
    data: WorkOrderCreateRequest,
) -> WorkOrderResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    wo_number = await work_order_repo.next_work_order_number(current_user.org_id)
    stops = [RouteStop(**s.model_dump()) for s in (data.route_stops or [])]

    wo = WorkOrder(
        org_id=current_user.org_id,
        framework_id=framework_id,
        work_order_number=wo_number,
        title=data.title,
        service_type=data.service_type,  # type: ignore[arg-type]
        planned_date=data.planned_date,
        assigned_vendor_id=data.assigned_vendor_id,
        assigned_vendor_name=data.assigned_vendor_name,
        technician_names=data.technician_names or [],
        route_stops=stops,
        total_assets=data.total_assets or len(stops),
        report_notes=data.report_notes,
        created_by=current_user.user_id,
    )
    wo = await work_order_repo.create(wo)

    # Update framework counter
    open_count = await work_order_repo.count_open(current_user.org_id, framework_id)
    fw.active_work_orders = open_count
    await framework_repo.update(fw)

    return _wo_to_response(wo)


async def generate_route_work_order(
    current_user: CurrentUser,
    framework_id: str,
    data: GenerateRouteRequest,
) -> WorkOrderResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    # Load assets and build route stops (nearest-neighbor already done on frontend;
    # here we trust the provided asset_ids order)
    stops = []
    for i, asset_id in enumerate(data.asset_ids):
        asset = await framework_asset_repo.get_by_id(current_user.org_id, asset_id)
        if asset:
            stops.append(RouteStop(
                sequence=i + 1,
                asset_id=asset_id,
                site_name=asset.site_name,
                site_code=asset.site_code,
                physical_address=asset.physical_address,
                gps_lat=asset.gps_lat,
                gps_lng=asset.gps_lng,
            ))

    wo_number = await work_order_repo.next_work_order_number(current_user.org_id)
    wo = WorkOrder(
        org_id=current_user.org_id,
        framework_id=framework_id,
        work_order_number=wo_number,
        title=f"Route — {len(stops)} sites",
        service_type="quarterly",
        planned_date=date.today().isoformat(),
        route_stops=stops,
        total_assets=len(stops),
        created_by=current_user.user_id,
    )
    wo = await work_order_repo.create(wo)
    return _wo_to_response(wo)


async def update_work_order(
    current_user: CurrentUser,
    framework_id: str,
    work_order_id: str,
    data: WorkOrderUpdateRequest,
) -> WorkOrderResponse:
    wo = await work_order_repo.get_by_id(current_user.org_id, work_order_id)
    if not wo or wo.framework_id != framework_id:
        raise ResourceNotFoundError("Work order not found")

    update_data = data.model_dump(exclude_none=True)

    if "route_stops" in update_data:
        wo.route_stops = [RouteStop(**s) for s in update_data.pop("route_stops")]
    if "parts_used" in update_data:
        wo.parts_used = [WorkOrderPart(**p) for p in update_data.pop("parts_used")]

    for field, value in update_data.items():
        setattr(wo, field, value)

    wo = await work_order_repo.update(wo)

    # Refresh framework counter
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if fw:
        fw.active_work_orders = await work_order_repo.count_open(current_user.org_id, framework_id)
        await framework_repo.update(fw)

    return _wo_to_response(wo)


# ── SLA Service ───────────────────────────────────────────────────────────────

async def list_sla_records(
    current_user: CurrentUser,
    framework_id: str,
    period: Optional[str] = None,
    asset_id: Optional[str] = None,
) -> List[SlaRecordResponse]:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")
    records = await sla_repo.list(current_user.org_id, framework_id, period=period, asset_id=asset_id)
    return [_sla_to_response(r) for r in records]


async def create_sla_record(
    current_user: CurrentUser,
    framework_id: str,
    data: SlaRecordCreateRequest,
) -> SlaRecordResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    events = [SlaEvent(**e.model_dump()) for e in (data.events or [])]
    record = SlaRecord(
        org_id=current_user.org_id,
        framework_id=framework_id,
        asset_id=data.asset_id,
        site_name=data.site_name,
        period_quarter=data.period_quarter,
        response_time_hours=data.response_time_hours,
        resolution_time_hours=data.resolution_time_hours,
        sla_level=data.sla_level,  # type: ignore[arg-type]
        events=events,
        penalty_percentage=data.penalty_percentage,
        penalty_amount=data.penalty_amount,
        notes=data.notes,
    )
    record = await sla_repo.create(record)
    return _sla_to_response(record)


# ── Spare Parts Service ───────────────────────────────────────────────────────

async def list_spare_parts_pricing(
    current_user: CurrentUser,
    framework_id: str,
) -> List[SparePartsPricingResponse]:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")
    items = await spare_parts_repo.list(current_user.org_id, framework_id)
    return [SparePartsPricingResponse(
        id=str(i.id), org_id=i.org_id, framework_id=i.framework_id,
        part_name=i.part_name, part_number=i.part_number,
        category=i.category, unit=i.unit,
        kva_pricing={k: float(v) for k, v in i.kva_pricing.items()},
        notes=i.notes,
    ) for i in items]


async def upsert_spare_part_pricing(
    current_user: CurrentUser,
    framework_id: str,
    data: SparePartsPricingRequest,
) -> SparePartsPricingResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    part = SparePartsPricing(
        org_id=current_user.org_id,
        framework_id=framework_id,
        part_name=data.part_name,
        part_number=data.part_number,
        category=data.category,
        unit=data.unit,
        kva_pricing=data.kva_pricing,
        notes=data.notes,
    )
    part = await spare_parts_repo.create(part)
    return SparePartsPricingResponse(
        id=str(part.id), org_id=part.org_id, framework_id=part.framework_id,
        part_name=part.part_name, part_number=part.part_number,
        category=part.category, unit=part.unit,
        kva_pricing={k: float(v) for k, v in part.kva_pricing.items()},
        notes=part.notes,
    )


# ── Transport Cost Service ────────────────────────────────────────────────────

async def list_transport_costs(
    current_user: CurrentUser,
    framework_id: str,
) -> List[TransportCostResponse]:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")
    items = await transport_cost_repo.list(current_user.org_id, framework_id)
    return [TransportCostResponse(
        id=str(i.id), org_id=i.org_id, framework_id=i.framework_id,
        region=i.region, description=i.description,
        road_rate_per_km=i.road_rate_per_km, air_rate=i.air_rate,
        fixed_allowance=i.fixed_allowance, notes=i.notes,
    ) for i in items]


async def upsert_transport_cost(
    current_user: CurrentUser,
    framework_id: str,
    data: TransportCostRequest,
) -> TransportCostResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework contract not found")

    entry = TransportCostEntry(
        org_id=current_user.org_id,
        framework_id=framework_id,
        region=data.region,
        description=data.description,
        road_rate_per_km=data.road_rate_per_km,
        air_rate=data.air_rate,
        fixed_allowance=data.fixed_allowance,
        notes=data.notes,
    )
    entry = await transport_cost_repo.create(entry)
    return TransportCostResponse(
        id=str(entry.id), org_id=entry.org_id, framework_id=entry.framework_id,
        region=entry.region, description=entry.description,
        road_rate_per_km=entry.road_rate_per_km, air_rate=entry.air_rate,
        fixed_allowance=entry.fixed_allowance, notes=entry.notes,
    )


# ── Pre-Inspection Service ────────────────────────────────────────────────────

async def submit_pre_inspection(
    current_user: CurrentUser,
    framework_id: str,
    work_order_id: str,
    data: PreInspectionSubmitRequest,
) -> WorkOrderResponse:
    wo = await work_order_repo.get_by_id(current_user.org_id, work_order_id)
    if not wo or wo.framework_id != framework_id:
        raise ResourceNotFoundError("Work order not found")

    items = []
    for item in data.items:
        total = round(item.quantity * item.estimated_unit_cost, 2)
        items.append(PreInspectionItem(
            part_name=item.part_name,
            part_number=item.part_number,
            kva_range=item.kva_range,
            quantity=item.quantity,
            estimated_unit_cost=item.estimated_unit_cost,
            estimated_total_cost=total,
            notes=item.notes,
        ))

    estimated_total = round(sum(i.estimated_total_cost for i in items), 2)

    wo.pre_inspection = PreInspection(
        inspection_date=data.inspection_date,
        technician_name=data.technician_name,
        condition_notes=data.condition_notes,
        items=items,
        estimated_total=estimated_total,
        status="submitted",
    )
    wo.status = "pending_approval"  # type: ignore[assignment]
    wo = await work_order_repo.update(wo)
    return _wo_to_response(wo)


async def review_pre_inspection(
    current_user: CurrentUser,
    framework_id: str,
    work_order_id: str,
    data: PreInspectionApproveRequest,
) -> WorkOrderResponse:
    wo = await work_order_repo.get_by_id(current_user.org_id, work_order_id)
    if not wo or wo.framework_id != framework_id:
        raise ResourceNotFoundError("Work order not found")
    if not wo.pre_inspection:
        raise ResourceNotFoundError("No pre-inspection found for this work order")

    if data.approved:
        wo.pre_inspection.status = "approved"
        wo.pre_inspection.approved_by = current_user.user_id
        wo.pre_inspection.approved_at = datetime.utcnow()
        wo.pre_inspection.approval_notes = data.approval_notes
        wo.status = "in_progress"  # type: ignore[assignment]
    else:
        wo.pre_inspection.status = "rejected"
        wo.pre_inspection.approval_notes = data.approval_notes
        wo.status = "pre_inspection"  # type: ignore[assignment]  # send back for re-inspection

    wo = await work_order_repo.update(wo)
    return _wo_to_response(wo)


# ── PDF Contract Extraction ───────────────────────────────────────────────────

async def extract_contract_from_pdf(pdf_bytes: bytes) -> Dict[str, Any]:
    """Use LLM to extract contract fields from a PDF. Returns extracted fields for review."""
    from app.core.config import settings

    # Extract text from PDF using PyMuPDF (fitz) or pypdf
    text = _extract_pdf_text(pdf_bytes)

    if not text.strip():
        return {
            "name": "", "client_name": "", "contract_number": "",
            "contract_start": "", "contract_end": "", "region": "",
            "description": "", "confidence": "low",
            "raw_text_preview": "",
        }

    # Truncate to ~8000 chars to stay within token limits
    text_excerpt = text[:8000]

    prompt = (
        "You are a contract data extraction assistant. Extract the following fields from the "
        "contract text below. Return a JSON object with exactly these keys:\n"
        "- name: short descriptive name for the contract (e.g. 'KCB Bank Genset Maintenance 2026')\n"
        "- client_name: the client / customer organization name\n"
        "- contract_number: the official contract reference/number\n"
        "- contract_start: contract start date in YYYY-MM-DD format\n"
        "- contract_end: contract end date in YYYY-MM-DD format\n"
        "- region: geographic region or coverage area\n"
        "- description: 1-2 sentence summary of contract scope\n"
        "- confidence: 'high', 'medium', or 'low' based on how clearly the info was found\n\n"
        "Return ONLY the JSON object, no markdown fences, no explanation.\n\n"
        f"CONTRACT TEXT:\n{text_excerpt}"
    )

    try:
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{settings.openai_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 512,
                },
            )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()

        # Strip any markdown fences if the model returned them
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        import json
        extracted = json.loads(raw)
        extracted["raw_text_preview"] = text_excerpt[:500]
        return extracted

    except Exception:
        # Return whatever text we extracted even if LLM call fails
        return {
            "name": "", "client_name": "", "contract_number": "",
            "contract_start": "", "contract_end": "", "region": "",
            "description": "",
            "confidence": "low",
            "raw_text_preview": text_excerpt[:500],
        }


# ── Regions & Sites service ───────────────────────────────────────────────────

async def update_regions_sites(
    current_user: CurrentUser,
    framework_id: str,
    request: FrameworkRegionsSitesRequest,
) -> FrameworkContractResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework not found")
    fw.regions = [r.strip() for r in request.regions if r.strip()]
    fw.sites = [
        FrameworkSite(
            site_code=s.site_code,
            site_name=s.site_name,
            region=s.region,
            physical_address=s.physical_address,
            gps_lat=s.gps_lat,
            gps_lng=s.gps_lng,
            contact_name=s.contact_name,
            contact_phone=s.contact_phone,
            notes=s.notes,
        )
        for s in request.sites
        if s.site_code.strip() and s.site_name.strip()
    ]
    fw = await framework_repo.update(fw)
    return _fw_to_response(fw)


# ── Schedule 4 service ───────────────────────────────────────────────────────

async def update_schedule4(
    current_user: CurrentUser,
    framework_id: str,
    request: Schedule4UpdateRequest,
) -> FrameworkContractResponse:
    from app.models.framework import Schedule4Entry
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework not found")
    fw.schedule4_entries = [
        Schedule4Entry(
            site_code=e.site_code,
            site_name=e.site_name,
            region=e.region,
            brand=e.brand,
            kva_rating=e.kva_rating,
            cost_a=e.cost_a,
            cost_b=e.cost_b,
            cost_c=e.cost_c,
            notes=e.notes,
        )
        for e in request.entries
        if e.site_name.strip() and e.region.strip()
    ]
    fw = await framework_repo.update(fw)
    return _fw_to_response(fw)


# ── Spare Parts Kit service ───────────────────────────────────────────────────

def _kit_item_to_response(item: SparePartsKitItem) -> SparePartsKitItemResponse:
    return SparePartsKitItemResponse(
        id=item.id,
        part_number=item.part_number,
        part_name=item.part_name,
        quantity=item.quantity,
        unit=item.unit,
        unit_price=item.unit_price,
        notes=item.notes,
    )


def _kit_to_response(kit: SparePartsKit) -> SparePartsKitResponse:
    return SparePartsKitResponse(
        id=str(kit.id),
        org_id=kit.org_id,
        framework_id=kit.framework_id,
        kit_name=kit.kit_name,
        validity_type=kit.validity_type,
        engine_make=kit.engine_make,
        engine_model=kit.engine_model,
        kva_min=kit.kva_min,
        kva_max=kit.kva_max,
        applicable_service_types=kit.applicable_service_types,
        site_code=kit.site_code,
        items=[_kit_item_to_response(i) for i in kit.items],
        notes=kit.notes,
        created_at=kit.created_at.isoformat(),
        updated_at=kit.updated_at.isoformat(),
    )


async def list_spare_parts_kits(current_user: CurrentUser, framework_id: str) -> List[SparePartsKitResponse]:
    kits = await spare_parts_kit_repo.list(current_user.org_id, framework_id)
    return [_kit_to_response(k) for k in kits]


async def create_spare_parts_kit(
    current_user: CurrentUser,
    framework_id: str,
    request: SparePartsKitCreateRequest,
) -> SparePartsKitResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework not found")
    items = [
        SparePartsKitItem(
            part_number=i.part_number,
            part_name=i.part_name,
            quantity=i.quantity,
            unit=i.unit,
            unit_price=i.unit_price,
            notes=i.notes,
        )
        for i in request.items
    ]
    kit = SparePartsKit(
        org_id=current_user.org_id,
        framework_id=framework_id,
        kit_name=request.kit_name,
        validity_type=request.validity_type,
        engine_make=request.engine_make,
        engine_model=request.engine_model,
        kva_min=request.kva_min,
        kva_max=request.kva_max,
        applicable_service_types=request.applicable_service_types,
        site_code=request.site_code,
        items=items,
        notes=request.notes,
    )
    kit = await spare_parts_kit_repo.create(kit)
    return _kit_to_response(kit)


async def update_spare_parts_kit(
    current_user: CurrentUser,
    framework_id: str,
    kit_id: str,
    request: SparePartsKitUpdateRequest,
) -> SparePartsKitResponse:
    kit = await spare_parts_kit_repo.get_by_id(current_user.org_id, kit_id)
    if not kit or kit.framework_id != framework_id:
        raise ResourceNotFoundError("Spare parts kit not found")
    if request.kit_name is not None:
        kit.kit_name = request.kit_name
    if request.validity_type is not None:
        kit.validity_type = request.validity_type  # type: ignore[assignment]
    if request.engine_make is not None:
        kit.engine_make = request.engine_make
    if request.engine_model is not None:
        kit.engine_model = request.engine_model
    if request.kva_min is not None:
        kit.kva_min = request.kva_min
    if request.kva_max is not None:
        kit.kva_max = request.kva_max
    if request.applicable_service_types is not None:
        kit.applicable_service_types = request.applicable_service_types
    if request.site_code is not None:
        kit.site_code = request.site_code
    if request.notes is not None:
        kit.notes = request.notes
    if request.items is not None:
        kit.items = [
            SparePartsKitItem(
                part_number=i.part_number,
                part_name=i.part_name,
                quantity=i.quantity,
                unit=i.unit,
                unit_price=i.unit_price,
                notes=i.notes,
            )
            for i in request.items
        ]
    kit = await spare_parts_kit_repo.update(kit)
    return _kit_to_response(kit)


async def delete_spare_parts_kit(current_user: CurrentUser, framework_id: str, kit_id: str) -> None:
    kit = await spare_parts_kit_repo.get_by_id(current_user.org_id, kit_id)
    if not kit or kit.framework_id != framework_id:
        raise ResourceNotFoundError("Spare parts kit not found")
    await spare_parts_kit_repo.soft_delete(kit)


# ── Rate Schedule service ─────────────────────────────────────────────────────

def _rate_schedule_to_response(rs: RateSchedule) -> RateScheduleResponse:
    return RateScheduleResponse(
        id=str(rs.id),
        org_id=rs.org_id,
        framework_id=rs.framework_id,
        pricing_tier=rs.pricing_tier,
        effective_date=rs.effective_date,
        expiry_date=rs.expiry_date,
        is_active=rs.is_active,
        labour_rates=[r.model_dump() for r in rs.labour_rates],
        accommodation_rates=[r.model_dump() for r in rs.accommodation_rates],
        personnel_transport_rates=[r.model_dump() for r in rs.personnel_transport_rates],
        generator_transport_rates=[r.model_dump() for r in rs.generator_transport_rates],
        site_overrides=[r.model_dump() for r in rs.site_overrides],
        notes=rs.notes,
        created_at=rs.created_at.isoformat(),
        updated_at=rs.updated_at.isoformat(),
    )


async def list_rate_schedules(current_user: CurrentUser, framework_id: str) -> List[RateScheduleResponse]:
    schedules = await rate_schedule_repo.list(current_user.org_id, framework_id)
    return [_rate_schedule_to_response(s) for s in schedules]


async def upsert_rate_schedule(
    current_user: CurrentUser,
    framework_id: str,
    request: RateScheduleUpsertRequest,
) -> RateScheduleResponse:
    fw = await framework_repo.get_by_id(current_user.org_id, framework_id)
    if not fw:
        raise ResourceNotFoundError("Framework not found")

    doc = RateSchedule(
        org_id=current_user.org_id,
        framework_id=framework_id,
        pricing_tier=request.pricing_tier,  # type: ignore[arg-type]
        effective_date=request.effective_date,
        expiry_date=request.expiry_date,
        is_active=request.is_active,
        labour_rates=[LabourRateEntry(**r.model_dump()) for r in request.labour_rates],
        accommodation_rates=[AccommodationRateEntry(**r.model_dump()) for r in request.accommodation_rates],
        personnel_transport_rates=[PersonnelTransportRate(**r.model_dump()) for r in request.personnel_transport_rates],
        generator_transport_rates=[GeneratorTransportRate(**r.model_dump()) for r in request.generator_transport_rates],
        site_overrides=[SiteRateOverride(**r.model_dump()) for r in request.site_overrides],
        notes=request.notes,
    )
    result = await rate_schedule_repo.upsert(current_user.org_id, framework_id, request.pricing_tier, doc)
    return _rate_schedule_to_response(result)


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract plain text from PDF bytes. Tries PyMuPDF first, falls back to pypdf."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = [page.get_text() for page in doc]
        return "\n".join(pages)
    except ImportError:
        pass

    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)
    except ImportError:
        pass

    return ""
