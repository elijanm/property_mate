"""Framework Asset Management API endpoints."""
from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.framework import (
    FrameworkAssetCreateRequest,
    FrameworkAssetListResponse,
    FrameworkAssetResponse,
    FrameworkAssetUpdateRequest,
    FrameworkContractCreateRequest,
    FrameworkContractResponse,
    FrameworkContractUpdateRequest,
    FrameworkRegionsSitesRequest,
    FrameworkStatsResponse,
    GenerateRouteRequest,
    MaintenanceScheduleCreateRequest,
    MaintenanceScheduleResponse,
    PreInspectionApproveRequest,
    PreInspectionSubmitRequest,
    Schedule4UpdateRequest,
    SlaRecordCreateRequest,
    SlaRecordResponse,
    SparePartsPricingRequest,
    SparePartsPricingResponse,
    SparePartsKitCreateRequest,
    SparePartsKitUpdateRequest,
    SparePartsKitResponse,
    RateScheduleUpsertRequest,
    RateScheduleResponse,
    TransportCostRequest,
    TransportCostResponse,
    WorkOrderCreateRequest,
    WorkOrderListResponse,
    WorkOrderResponse,
    WorkOrderUpdateRequest,
)
from app.services import framework_service
from app.models.framework import FrameworkInvitedVendor

router = APIRouter(prefix="/frameworks", tags=["frameworks"])

_ROLES = ["owner", "agent", "superadmin"]


# ── Framework Contracts ───────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[FrameworkContractResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_frameworks(
    current_user: CurrentUser = Depends(get_current_user),
) -> List[FrameworkContractResponse]:
    return await framework_service.list_frameworks(current_user)


@router.post(
    "",
    response_model=FrameworkContractResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_framework(
    request: FrameworkContractCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkContractResponse:
    return await framework_service.create_framework(current_user, request)


@router.get(
    "/{framework_id}",
    response_model=FrameworkContractResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def get_framework(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkContractResponse:
    return await framework_service.get_framework(current_user, framework_id)


@router.patch(
    "/{framework_id}",
    response_model=FrameworkContractResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_framework(
    framework_id: str,
    request: FrameworkContractUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkContractResponse:
    return await framework_service.update_framework(current_user, framework_id, request)


@router.delete(
    "/{framework_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_framework(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await framework_service.delete_framework(current_user, framework_id)


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/stats",
    response_model=FrameworkStatsResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def get_framework_stats(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkStatsResponse:
    return await framework_service.get_framework_stats(current_user, framework_id)


# ── Assets ────────────────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/assets",
    response_model=FrameworkAssetListResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_framework_assets(
    framework_id: str,
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    kva: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkAssetListResponse:
    return await framework_service.list_framework_assets(
        current_user, framework_id,
        search=search, status=status, kva=kva, region=region, page=page,
    )


@router.post(
    "/{framework_id}/assets",
    response_model=FrameworkAssetResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_framework_asset(
    framework_id: str,
    request: FrameworkAssetCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkAssetResponse:
    return await framework_service.create_framework_asset(current_user, framework_id, request)


@router.get(
    "/{framework_id}/assets/{asset_id}",
    response_model=FrameworkAssetResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def get_framework_asset(
    framework_id: str,
    asset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkAssetResponse:
    from app.repositories.framework_repository import framework_asset_repo
    from app.core.exceptions import ResourceNotFoundError
    asset = await framework_asset_repo.get_by_id(current_user.org_id, asset_id)
    if not asset or asset.framework_id != framework_id:
        raise ResourceNotFoundError("Asset not found")
    return framework_service._asset_to_response(asset)


@router.patch(
    "/{framework_id}/assets/{asset_id}",
    response_model=FrameworkAssetResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_framework_asset(
    framework_id: str,
    asset_id: str,
    request: FrameworkAssetUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkAssetResponse:
    return await framework_service.update_framework_asset(current_user, framework_id, asset_id, request)


@router.delete(
    "/{framework_id}/assets/{asset_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_framework_asset(
    framework_id: str,
    asset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await framework_service.delete_framework_asset(current_user, framework_id, asset_id)


# ── Regions & Sites ──────────────────────────────────────────────────────────

@router.put(
    "/{framework_id}/regions-sites",
    response_model=FrameworkContractResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_regions_sites(
    framework_id: str,
    request: FrameworkRegionsSitesRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkContractResponse:
    return await framework_service.update_regions_sites(current_user, framework_id, request)


# ── Maintenance Schedules ─────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/schedules",
    response_model=List[MaintenanceScheduleResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_schedules(
    framework_id: str,
    month: Optional[str] = Query(None, description="YYYY-MM prefix"),
    status: Optional[str] = Query(None),
    asset_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[MaintenanceScheduleResponse]:
    return await framework_service.list_schedules(current_user, framework_id, month=month, status=status, asset_id=asset_id)


@router.post(
    "/{framework_id}/schedules",
    response_model=MaintenanceScheduleResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_schedule(
    framework_id: str,
    request: MaintenanceScheduleCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MaintenanceScheduleResponse:
    return await framework_service.create_schedule(current_user, framework_id, request)


@router.patch(
    "/{framework_id}/schedules/{schedule_id}",
    response_model=MaintenanceScheduleResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_schedule_status(
    framework_id: str,
    schedule_id: str,
    payload: dict,
    current_user: CurrentUser = Depends(get_current_user),
) -> MaintenanceScheduleResponse:
    new_status = payload.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="status field required")
    return await framework_service.update_schedule_status(current_user, framework_id, schedule_id, new_status)


# ── Work Orders ───────────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/work-orders",
    response_model=WorkOrderListResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_work_orders(
    framework_id: str,
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderListResponse:
    return await framework_service.list_work_orders(current_user, framework_id, status=status, page=page)


@router.post(
    "/{framework_id}/work-orders",
    response_model=WorkOrderResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_work_order(
    framework_id: str,
    request: WorkOrderCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.create_work_order(current_user, framework_id, request)


@router.post(
    "/{framework_id}/work-orders/generate-route",
    response_model=WorkOrderResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def generate_route_work_order(
    framework_id: str,
    request: GenerateRouteRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.generate_route_work_order(current_user, framework_id, request)


@router.get(
    "/{framework_id}/work-orders/{work_order_id}",
    response_model=WorkOrderResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def get_work_order(
    framework_id: str,
    work_order_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.get_work_order(current_user, framework_id, work_order_id)


@router.patch(
    "/{framework_id}/work-orders/{work_order_id}",
    response_model=WorkOrderResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_work_order(
    framework_id: str,
    work_order_id: str,
    request: WorkOrderUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.update_work_order(current_user, framework_id, work_order_id, request)


# ── Pre-Inspection ────────────────────────────────────────────────────────────

@router.post(
    "/{framework_id}/work-orders/{work_order_id}/pre-inspection",
    response_model=WorkOrderResponse,
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def submit_pre_inspection(
    framework_id: str,
    work_order_id: str,
    request: PreInspectionSubmitRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.submit_pre_inspection(current_user, framework_id, work_order_id, request)


@router.patch(
    "/{framework_id}/work-orders/{work_order_id}/pre-inspection/review",
    response_model=WorkOrderResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def review_pre_inspection(
    framework_id: str,
    work_order_id: str,
    request: PreInspectionApproveRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkOrderResponse:
    return await framework_service.review_pre_inspection(current_user, framework_id, work_order_id, request)


# ── SLA Records ───────────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/sla",
    response_model=List[SlaRecordResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_sla_records(
    framework_id: str,
    period: Optional[str] = Query(None, description="e.g. 2026-Q1"),
    asset_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[SlaRecordResponse]:
    return await framework_service.list_sla_records(current_user, framework_id, period=period, asset_id=asset_id)


@router.post(
    "/{framework_id}/sla",
    response_model=SlaRecordResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_sla_record(
    framework_id: str,
    request: SlaRecordCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> SlaRecordResponse:
    return await framework_service.create_sla_record(current_user, framework_id, request)


# ── Spare Parts Pricing ───────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/spare-parts",
    response_model=List[SparePartsPricingResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_spare_parts(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[SparePartsPricingResponse]:
    return await framework_service.list_spare_parts_pricing(current_user, framework_id)


@router.post(
    "/{framework_id}/spare-parts",
    response_model=SparePartsPricingResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_spare_part(
    framework_id: str,
    request: SparePartsPricingRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> SparePartsPricingResponse:
    return await framework_service.upsert_spare_part_pricing(current_user, framework_id, request)


# ── Transport Costs ───────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/transport-costs",
    response_model=List[TransportCostResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_transport_costs(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[TransportCostResponse]:
    return await framework_service.list_transport_costs(current_user, framework_id)


@router.post(
    "/{framework_id}/transport-costs",
    response_model=TransportCostResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_transport_cost(
    framework_id: str,
    request: TransportCostRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> TransportCostResponse:
    return await framework_service.upsert_transport_cost(current_user, framework_id, request)


# ── Spare Parts Kits ──────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/parts-kits",
    response_model=List[SparePartsKitResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_parts_kits(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[SparePartsKitResponse]:
    return await framework_service.list_spare_parts_kits(current_user, framework_id)


@router.post(
    "/{framework_id}/parts-kits",
    response_model=SparePartsKitResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_parts_kit(
    framework_id: str,
    request: SparePartsKitCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> SparePartsKitResponse:
    return await framework_service.create_spare_parts_kit(current_user, framework_id, request)


@router.patch(
    "/{framework_id}/parts-kits/{kit_id}",
    response_model=SparePartsKitResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_parts_kit(
    framework_id: str,
    kit_id: str,
    request: SparePartsKitUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> SparePartsKitResponse:
    return await framework_service.update_spare_parts_kit(current_user, framework_id, kit_id, request)


@router.delete(
    "/{framework_id}/parts-kits/{kit_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_parts_kit(
    framework_id: str,
    kit_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await framework_service.delete_spare_parts_kit(current_user, framework_id, kit_id)


# ── Rate Schedule ─────────────────────────────────────────────────────────────

@router.get(
    "/{framework_id}/rate-schedules",
    response_model=List[RateScheduleResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_rate_schedules(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[RateScheduleResponse]:
    return await framework_service.list_rate_schedules(current_user, framework_id)


@router.put(
    "/{framework_id}/rate-schedules",
    response_model=RateScheduleResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def upsert_rate_schedule(
    framework_id: str,
    request: RateScheduleUpsertRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> RateScheduleResponse:
    return await framework_service.upsert_rate_schedule(current_user, framework_id, request)


# ── Schedule 4 – Schedule of Rates ───────────────────────────────────────────

@router.put(
    "/{framework_id}/schedule4",
    response_model=FrameworkContractResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_schedule4(
    framework_id: str,
    request: Schedule4UpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> FrameworkContractResponse:
    return await framework_service.update_schedule4(current_user, framework_id, request)


# ── Invited Vendors ───────────────────────────────────────────────────────────

class InvitedVendorCreate(BaseModel):
    name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    specialization: Optional[str] = None
    regions: Optional[str] = None


class InvitedVendorResponse(BaseModel):
    id: str
    framework_id: str
    name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    mobile: Optional[str] = None
    specialization: Optional[str] = None
    regions: Optional[str] = None
    site_codes: list[str] = []
    status: str = "invited"
    invited_at: str
    reinvited_at: Optional[str] = None
    activated_at: Optional[str] = None
    portal_token: Optional[str] = None


def _invited_to_resp(m: FrameworkInvitedVendor) -> InvitedVendorResponse:
    return InvitedVendorResponse(
        id=str(m.id),
        framework_id=m.framework_id,
        name=m.name,
        contact_name=m.contact_name,
        email=m.email,
        phone=m.phone,
        mobile=m.mobile,
        specialization=m.specialization,
        regions=m.regions,
        site_codes=m.site_codes,
        status=m.status,
        invited_at=m.invited_at.isoformat(),
        reinvited_at=m.reinvited_at.isoformat() if m.reinvited_at else None,
        activated_at=m.activated_at.isoformat() if m.activated_at else None,
        portal_token=m.portal_token,
    )


@router.get(
    "/{framework_id}/invited-vendors",
    response_model=List[InvitedVendorResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_invited_vendors(
    framework_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[InvitedVendorResponse]:
    items = await FrameworkInvitedVendor.find(
        FrameworkInvitedVendor.org_id == current_user.org_id,
        FrameworkInvitedVendor.framework_id == framework_id,
        FrameworkInvitedVendor.deleted_at == None,
    ).sort(-FrameworkInvitedVendor.invited_at).to_list()
    return [_invited_to_resp(m) for m in items]


@router.post(
    "/{framework_id}/invited-vendors",
    response_model=InvitedVendorResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def invite_vendor(
    framework_id: str,
    request: InvitedVendorCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvitedVendorResponse:
    from app.models.framework import FrameworkContract
    from app.models.org import Org
    from app.core.email import send_email, framework_vendor_invite_html
    import asyncio

    member = FrameworkInvitedVendor(
        org_id=current_user.org_id,
        framework_id=framework_id,
        name=request.name,
        contact_name=request.contact_name,
        email=request.email,
        phone=request.phone,
        specialization=request.specialization,
        regions=request.regions,
    )
    await member.insert()

    # Fire-and-forget email
    from beanie import PydanticObjectId as _OID
    fw = await FrameworkContract.find_one(
        FrameworkContract.id == _OID(framework_id),
        FrameworkContract.org_id == current_user.org_id,
    )
    org = await Org.find_one(Org.org_id == current_user.org_id) if fw else None
    if fw:
        from app.core.config import settings as _cfg
        portal_url = f"{_cfg.app_base_url}/framework-portal/invite/{member.portal_token}"
        asyncio.ensure_future(send_email(
            to=request.email,
            subject=f"Service Provider Invitation — {fw.name}",
            html=framework_vendor_invite_html(
                contact_name=request.contact_name,
                company_name=request.name,
                framework_name=fw.name,
                client_name=fw.client_name,
                org_name=(org.business.name if org and org.business else "PMS"),
                portal_url=portal_url,
                is_reinvite=False,
            ),
        ))

    return _invited_to_resp(member)


@router.post(
    "/{framework_id}/invited-vendors/{member_id}/reinvite",
    response_model=InvitedVendorResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def reinvite_vendor(
    framework_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvitedVendorResponse:
    from beanie import PydanticObjectId
    from datetime import datetime
    from app.models.framework import FrameworkContract
    from app.models.org import Org
    from app.core.email import send_email, framework_vendor_invite_html
    import asyncio

    member = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == PydanticObjectId(member_id),
        FrameworkInvitedVendor.org_id == current_user.org_id,
        FrameworkInvitedVendor.framework_id == framework_id,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not member:
        raise HTTPException(status_code=404, detail="Invited vendor not found")
    member.reinvited_at = datetime.utcnow()
    await member.save()

    # Fire-and-forget re-invite email
    fw = await FrameworkContract.find_one(
        FrameworkContract.id == PydanticObjectId(framework_id),
        FrameworkContract.org_id == current_user.org_id,
    )
    org = await Org.find_one(Org.org_id == current_user.org_id) if fw else None
    if fw:
        from app.core.config import settings as _cfg
        portal_url = f"{_cfg.app_base_url}/framework-portal/invite/{member.portal_token}"
        asyncio.ensure_future(send_email(
            to=member.email,
            subject=f"Reminder: Service Provider Invitation — {fw.name}",
            html=framework_vendor_invite_html(
                contact_name=member.contact_name,
                company_name=member.name,
                framework_name=fw.name,
                client_name=fw.client_name,
                org_name=(org.business.name if org and org.business else "PMS"),
                portal_url=portal_url,
                is_reinvite=True,
            ),
        ))

    return _invited_to_resp(member)


@router.delete(
    "/{framework_id}/invited-vendors/{member_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def remove_invited_vendor(
    framework_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    from beanie import PydanticObjectId
    from datetime import datetime
    member = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == PydanticObjectId(member_id),
        FrameworkInvitedVendor.org_id == current_user.org_id,
        FrameworkInvitedVendor.framework_id == framework_id,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not member:
        raise HTTPException(status_code=404, detail="Invited vendor not found")
    member.deleted_at = datetime.utcnow()
    await member.save()


# ── Invited Vendor KYC Docs (owner view) ──────────────────────────────────────

@router.get(
    "/{framework_id}/invited-vendors/{member_id}/docs",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def get_vendor_docs(
    framework_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    from beanie import PydanticObjectId
    from app.core.s3 import generate_presigned_url

    member = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == PydanticObjectId(member_id),
        FrameworkInvitedVendor.org_id == current_user.org_id,
        FrameworkInvitedVendor.framework_id == framework_id,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not member:
        raise HTTPException(status_code=404, detail="Invited vendor not found")

    async def _url(key: Optional[str]) -> Optional[str]:
        return await generate_presigned_url(key) if key else None

    selfie_url, id_front_url, id_back_url, badge_url = await asyncio.gather(
        _url(member.selfie_key),
        _url(member.id_front_key),
        _url(member.id_back_key),
        _url(member.badge_key),
    )

    return {
        "has_selfie": bool(member.selfie_key),
        "has_id_front": bool(member.id_front_key),
        "has_id_back": bool(member.id_back_key),
        "has_badge": bool(member.badge_key),
        "selfie_url": selfie_url,
        "id_front_url": id_front_url,
        "id_back_url": id_back_url,
        "badge_url": badge_url,
        "status": member.status,
        "activated_at": member.activated_at.isoformat() if member.activated_at else None,
        "gps_lat": member.gps_lat,
        "gps_lng": member.gps_lng,
        "mobile": member.mobile,
        "site_codes": member.site_codes,
    }


# ── PDF Contract Extraction ───────────────────────────────────────────────────

@router.post(
    "/extract-pdf",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def extract_contract_pdf(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Upload a PDF contract and extract key fields using AI for review before saving."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20 MB max
        raise HTTPException(status_code=400, detail="PDF file too large (max 20 MB)")

    extracted = await framework_service.extract_contract_from_pdf(content)
    return extracted
