"""Accounting API — summary, tenant behavior, vacancy reports."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.accounting import AccountingSummaryResponse, TenantBehaviorListResponse, VacancyLiveResponse, VacancyReportResponse
from app.services import accounting_service

router = APIRouter(prefix="/accounting", tags=["accounting"])


@router.get(
    "/summary",
    response_model=AccountingSummaryResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_summary(
    billing_month: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> AccountingSummaryResponse:
    return await accounting_service.get_accounting_summary(
        current_user, billing_month=billing_month, property_id=property_id
    )


@router.get(
    "/tenant-behavior",
    response_model=TenantBehaviorListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_tenant_behavior(
    cursor: Optional[str] = Query(None),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("outstanding", pattern="^(outstanding|reliability)$"),
    current_user: CurrentUser = Depends(get_current_user),
) -> TenantBehaviorListResponse:
    return await accounting_service.get_tenant_behavior(
        current_user, cursor=cursor, page_size=page_size, sort_by=sort_by
    )


@router.get(
    "/vacancy-live",
    response_model=VacancyLiveResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_vacancy_live(
    property_id: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> VacancyLiveResponse:
    """Live vacancy snapshot — computed from current unit/lease state, no billing run required."""
    return await accounting_service.get_vacancy_live(
        current_user, property_id=property_id, cursor=cursor, page_size=page_size
    )


@router.get(
    "/vacancy-report/{billing_month}",
    response_model=VacancyReportResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_vacancy_report(
    billing_month: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> VacancyReportResponse:
    return await accounting_service.get_vacancy_report(current_user, billing_month)
