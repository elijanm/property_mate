"""Accounting service — summary, tenant behavior, vacancy reports."""
from datetime import date, datetime, timedelta
from typing import List, Optional

import structlog

from app.dependencies.auth import CurrentUser
from app.models.invoice import Invoice
from app.repositories.invoice_repository import invoice_repository, vacancy_report_repository
from app.repositories.property_repository import property_repository
from app.repositories.user_repository import user_repository
from app.schemas.accounting import (
    AccountingSummaryResponse,
    PropertyRevenue,
    TenantBehaviorListResponse,
    TenantBehaviorResponse,
    VacancyLiveResponse,
    VacancyReportResponse,
    VacantUnitDetailResponse,
)
from app.core.exceptions import ForbiddenError, ResourceNotFoundError

logger = structlog.get_logger(__name__)


def _check_role(current_user: CurrentUser) -> None:
    if current_user.role not in ("owner", "agent", "superadmin"):
        raise ForbiddenError("Insufficient permissions to view accounting data")


async def get_accounting_summary(
    current_user: CurrentUser,
    billing_month: Optional[str] = None,
    property_id: Optional[str] = None,
) -> AccountingSummaryResponse:
    _check_role(current_user)
    org_id = current_user.org_id

    # Fetch non-sandbox rent invoices (optionally filtered by month and/or property)
    items, _ = await invoice_repository.list(
        org_id=org_id,
        billing_month=billing_month,
        property_id=property_id,
        sandbox=False,
        invoice_category="rent",
        page=1,
        page_size=100000,
    )

    total_invoiced = sum(inv.total_amount for inv in items if inv.status != "void")
    total_collected = sum(inv.amount_paid for inv in items if inv.status != "void")
    total_outstanding = sum(inv.balance_due for inv in items if inv.status not in ("void", "paid"))
    collection_rate = (total_collected / total_invoiced) if total_invoiced > 0 else 0.0

    # By status
    by_status: dict = {}
    for inv in items:
        if inv.status != "void":
            by_status[inv.status] = by_status.get(inv.status, 0) + inv.total_amount

    # By property
    prop_map: dict = {}
    for inv in items:
        if inv.status == "void":
            continue
        pid = inv.property_id
        if pid not in prop_map:
            prop_map[pid] = {"invoiced": 0.0, "collected": 0.0, "outstanding": 0.0}
        prop_map[pid]["invoiced"] += inv.total_amount
        prop_map[pid]["collected"] += inv.amount_paid
        prop_map[pid]["outstanding"] += inv.balance_due

    by_property: List[PropertyRevenue] = []
    for pid, data in prop_map.items():
        prop = await property_repository.get_by_id(pid, org_id)
        by_property.append(PropertyRevenue(
            property_id=pid,
            property_name=prop.name if prop else pid,
            invoiced=data["invoiced"],
            collected=data["collected"],
            outstanding=data["outstanding"],
        ))

    return AccountingSummaryResponse(
        total_invoiced=total_invoiced,
        total_collected=total_collected,
        total_outstanding=total_outstanding,
        collection_rate=collection_rate,
        by_property=by_property,
        by_status=by_status,
    )


async def get_tenant_behavior(
    current_user: CurrentUser,
    cursor: Optional[str] = None,
    page_size: int = 20,
    sort_by: str = "outstanding",   # "outstanding" | "reliability"
) -> TenantBehaviorListResponse:
    import base64
    _check_role(current_user)
    org_id = current_user.org_id

    items, _ = await invoice_repository.list(
        org_id=org_id,
        sandbox=False,
        invoice_category="rent",
        page=1,
        page_size=100000,
    )

    # Group invoices by tenant
    tenant_map: dict = {}
    for inv in items:
        if inv.status == "void":
            continue
        tid = inv.tenant_id
        if tid not in tenant_map:
            tenant_map[tid] = []
        tenant_map[tid].append(inv)

    results: List[TenantBehaviorResponse] = []
    for tid, invoices in tenant_map.items():
        user = await user_repository.get_by_id(tid)
        name = f"{user.first_name} {user.last_name}".strip() if user else tid

        GRACE_DAYS = 7   # paid within 7 days of due date = "on time"
        DELAY_CEIL = 90  # 90+ days average delay → delay_score bottoms out at 0

        total = len(invoices)
        paid_on_time = 0
        partial = 0
        total_delay_days = 0
        delay_count = 0
        outstanding = 0.0

        from datetime import timezone as _tz
        for inv in invoices:
            outstanding += inv.balance_due
            if inv.status == "partial_paid":
                partial += 1
            # Delay stats: only fully-paid invoices have a reliable paid_at
            if inv.status == "paid" and inv.paid_at and inv.due_date:
                due = datetime(inv.due_date.year, inv.due_date.month, inv.due_date.day, tzinfo=_tz.utc)
                paid = inv.paid_at if inv.paid_at.tzinfo else inv.paid_at.replace(tzinfo=_tz.utc)
                delay = (paid - due).days
                if delay <= GRACE_DAYS:
                    paid_on_time += 1
                total_delay_days += max(delay, 0)
                delay_count += 1

        # on_time_rate: fraction of fully-paid invoices settled within grace period
        on_time_rate = (paid_on_time / delay_count) if delay_count > 0 else 0.0
        avg_delay = (total_delay_days / delay_count) if delay_count > 0 else 0.0

        # reliability: payment frequency × timeliness (independent of on_time_rate)
        #   payment_rate: how often tenant pays something (paid + partial vs total)
        #   delay_score:  0 = avg 90+ days late, 1 = always on time
        ever_paid_count = sum(1 for inv in invoices if inv.status in ("paid", "partial_paid"))
        payment_rate = ever_paid_count / total if total > 0 else 0.0
        delay_score = max(0.0, 1.0 - (avg_delay / DELAY_CEIL))
        reliability = payment_rate * delay_score

        results.append(TenantBehaviorResponse(
            tenant_id=tid,
            tenant_name=name,
            avg_payment_delay_days=round(avg_delay, 1),
            on_time_rate=round(on_time_rate, 2),
            outstanding_balance=outstanding,
            reliability_score=round(reliability, 2),
            total_invoices=total,
            partial_payments=partial,
        ))

    if sort_by == "reliability":
        results.sort(key=lambda r: r.reliability_score, reverse=True)
    else:
        results.sort(key=lambda r: r.outstanding_balance, reverse=True)

    total_count = len(results)
    offset = 0
    if cursor:
        try:
            offset = int(base64.b64decode(cursor.encode()).decode())
        except Exception:
            offset = 0

    page_items = results[offset: offset + page_size]
    next_offset = offset + page_size
    has_more = next_offset < total_count
    next_cursor = base64.b64encode(str(next_offset).encode()).decode() if has_more else None

    return TenantBehaviorListResponse(
        items=page_items,
        total=total_count,
        next_cursor=next_cursor,
        has_more=has_more,
    )


async def get_vacancy_report(
    current_user: CurrentUser,
    billing_month: str,
) -> VacancyReportResponse:
    _check_role(current_user)
    report = await vacancy_report_repository.get_by_month(current_user.org_id, billing_month)
    if not report:
        raise ResourceNotFoundError("VacancyReport", billing_month)

    return VacancyReportResponse(
        id=str(report.id),
        org_id=report.org_id,
        billing_month=report.billing_month,
        billing_cycle_run_id=report.billing_cycle_run_id,
        total_units=report.total_units,
        occupied_units=report.occupied_units,
        vacant_units=report.vacant_units,
        vacancy_rate=report.vacancy_rate,
        vacant_details=[
            VacantUnitDetailResponse(
                property_id=d.property_id,
                property_name=d.property_name,
                unit_id=d.unit_id,
                unit_label=d.unit_label,
                days_vacant=d.days_vacant,
                estimated_rent=d.estimated_rent,
                estimated_lost_rent=d.estimated_lost_rent,
            )
            for d in report.vacant_details
        ],
        estimated_lost_rent=report.estimated_lost_rent,
    )


async def get_vacancy_live(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    cursor: Optional[str] = None,
    page_size: int = 20,
) -> VacancyLiveResponse:
    """Compute vacancy snapshot directly from unit/lease state — no billing run required.

    Supports optional property_id scoping and cursor-based pagination.
    Cursor is a base64-encoded integer offset into the sorted results.
    """
    import base64
    _check_role(current_user)

    from app.models.property import Property
    from app.models.unit import Unit
    from app.models.lease import Lease

    # Build property map (scoped or org-wide)
    prop_filter: dict = {"org_id": current_user.org_id, "deleted_at": None}
    if property_id:
        from app.models.property import Property as Prop
        from beanie import PydanticObjectId as PId
        try:
            prop_filter["_id"] = PId(property_id)
        except Exception:
            pass
    properties = await Property.find(prop_filter).to_list()
    prop_map = {str(p.id): p.name for p in properties}
    scoped_prop_ids = set(prop_map.keys())

    # Units — scoped to the property if requested
    unit_filter: dict = {"org_id": current_user.org_id, "deleted_at": None}
    if property_id and scoped_prop_ids:
        from beanie import PydanticObjectId as PId
        try:
            unit_filter["property_id"] = PId(property_id)
        except Exception:
            pass
    units = await Unit.find(unit_filter).to_list()
    total_units = len(units)

    # Active leases to determine occupancy
    lease_filter: dict = {"org_id": current_user.org_id, "status": "active", "deleted_at": None}
    if property_id:
        lease_filter["property_id"] = property_id
    active_leases = await Lease.find(lease_filter).to_list()
    occupied_unit_ids = {lease.unit_id for lease in active_leases}

    occupied_units = sum(1 for u in units if str(u.id) in occupied_unit_ids)
    vacant_units_list = [u for u in units if str(u.id) not in occupied_unit_ids]
    vacant_count = len(vacant_units_list)
    vacancy_rate = (vacant_count / total_units) if total_units > 0 else 0.0

    def _vacated_on(pl) -> date:
        if pl.end_date:
            return pl.end_date
        if pl.terminated_at:
            return pl.terminated_at.date()
        return date(2000, 1, 1)

    today = date.today()
    all_details: list[VacantUnitDetailResponse] = []
    estimated_lost_rent = 0.0

    for u in vacant_units_list:
        past_leases = await Lease.find(
            {
                "org_id": current_user.org_id,
                "unit_id": str(u.id),
                "status": {"$in": ["expired", "terminated"]},
                "deleted_at": None,
            }
        ).to_list()

        last_lease = None
        days_vacant = 0
        if past_leases:
            last_lease = max(past_leases, key=_vacated_on)
            days_vacant = max(0, (today - _vacated_on(last_lease)).days)
        else:
            days_vacant = max(0, (today - u.created_at.date()).days)

        rent = (last_lease.rent_amount if last_lease else None) or u.rent_base or 0.0
        lost = round(rent * (days_vacant / 30.0), 2) if rent and days_vacant > 0 else 0.0
        estimated_lost_rent += lost

        all_details.append(VacantUnitDetailResponse(
            property_id=str(u.property_id) if u.property_id else "",
            property_name=prop_map.get(str(u.property_id), ""),
            unit_id=str(u.id),
            unit_label=u.unit_code or str(u.id),
            days_vacant=days_vacant,
            estimated_rent=rent,
            estimated_lost_rent=lost,
        ))

    # Sort by most days vacant first (stable sort)
    all_details.sort(key=lambda d: d.days_vacant, reverse=True)

    # Cursor-based pagination: cursor encodes the start offset
    offset = 0
    if cursor:
        try:
            offset = int(base64.b64decode(cursor.encode()).decode())
        except Exception:
            offset = 0

    page_items = all_details[offset: offset + page_size]
    next_offset = offset + page_size
    has_more = next_offset < len(all_details)
    next_cursor = base64.b64encode(str(next_offset).encode()).decode() if has_more else None

    return VacancyLiveResponse(
        total_units=total_units,
        occupied_units=occupied_units,
        vacant_units=vacant_count,
        vacancy_rate=round(vacancy_rate, 4),
        estimated_lost_rent=round(estimated_lost_rent, 2),
        items=page_items,
        next_cursor=next_cursor,
        has_more=has_more,
    )
