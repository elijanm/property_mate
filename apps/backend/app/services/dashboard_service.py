"""Dashboard service — aggregates KPIs for the owner dashboard in a single call."""
import asyncio
from datetime import date, datetime, timedelta
from typing import Optional

from app.dependencies.auth import CurrentUser
from app.models.invoice import Invoice
from app.models.lease import Lease
from app.models.payment import Payment
from app.models.ticket import Ticket
from app.models.unit import Unit
from app.models.user import User
from app.schemas.dashboard import (
    AlertCounts,
    CollectionTrendEntry,
    DashboardData,
    FinancialKpi,
    OccupancyKpi,
    RecentPayment,
    RecentTicket,
)
from app.utils.datetime import utc_now


async def get_dashboard(current_user: CurrentUser) -> DashboardData:
    org_id = current_user.org_id
    today = utc_now().date()

    (
        occupancy,
        financial,
        alerts,
        recent_payments,
        recent_tickets,
        trend,
    ) = await asyncio.gather(
        _build_occupancy(org_id),
        _build_financial(org_id, today),
        _build_alerts(org_id, today),
        _build_recent_payments(org_id),
        _build_recent_tickets(org_id),
        _build_collection_trend(org_id, today),
    )

    return DashboardData(
        occupancy=occupancy,
        financial=financial,
        alerts=alerts,
        recent_payments=recent_payments,
        recent_tickets=recent_tickets,
        collection_trend=trend,
    )


# ── helpers ───────────────────────────────────────────────────────────────────

async def _build_occupancy(org_id: str) -> OccupancyKpi:
    pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    rows = await Unit.get_pymongo_collection().aggregate(pipeline).to_list(length=None)
    counts: dict[str, int] = {r["_id"]: r["count"] for r in rows}

    total = sum(counts.values())
    occupied = sum(counts.get(s, 0) for s in ("occupied", "booked", "reserved"))
    vacant = counts.get("vacant", 0)
    rate = round(occupied / total * 100, 1) if total else 0.0

    return OccupancyKpi(
        total_units=total,
        occupied=occupied,
        vacant=vacant,
        occupancy_rate=rate,
    )


async def _build_financial(org_id: str, today: date) -> FinancialKpi:
    billing_month = today.strftime("%Y-%m")

    # Outstanding balance across all non-void non-sandbox invoices
    outstanding_pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None, "sandbox": False, "status": {"$nin": ["void", "paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$balance_due"}}},
    ]

    # This month invoiced + collected
    month_pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None, "sandbox": False, "billing_month": billing_month}},
        {
            "$group": {
                "_id": None,
                "invoiced": {"$sum": "$total_amount"},
                "collected": {"$sum": "$amount_paid"},
            }
        },
    ]

    # 30-day collection rate: invoices due in last 30 days
    cutoff = today - timedelta(days=30)
    cutoff_str = cutoff.isoformat()
    rate_pipeline = [
        {
            "$match": {
                "org_id": org_id,
                "deleted_at": None,
                "sandbox": False,
                "due_date": {"$gte": cutoff_str},
                "status": {"$nin": ["void"]},
            }
        },
        {
            "$group": {
                "_id": None,
                "invoiced": {"$sum": "$total_amount"},
                "collected": {"$sum": "$amount_paid"},
            }
        },
    ]

    col = Invoice.get_pymongo_collection()
    out_rows, month_rows, rate_rows = await asyncio.gather(
        col.aggregate(outstanding_pipeline).to_list(length=None),
        col.aggregate(month_pipeline).to_list(length=None),
        col.aggregate(rate_pipeline).to_list(length=None),
    )

    outstanding_balance = out_rows[0]["total"] if out_rows else 0.0
    this_month_invoiced = month_rows[0]["invoiced"] if month_rows else 0.0
    this_month_collected = month_rows[0]["collected"] if month_rows else 0.0

    rate_invoiced = rate_rows[0]["invoiced"] if rate_rows else 0.0
    rate_collected = rate_rows[0]["collected"] if rate_rows else 0.0
    collection_rate_30d = round(rate_collected / rate_invoiced * 100, 1) if rate_invoiced else None

    return FinancialKpi(
        outstanding_balance=outstanding_balance,
        this_month_invoiced=this_month_invoiced,
        this_month_collected=this_month_collected,
        collection_rate_30d=collection_rate_30d,
    )


async def _build_alerts(org_id: str, today: date) -> AlertCounts:
    expiry_horizon = today + timedelta(days=30)

    open_tickets_query = Ticket.find(
        {
            "org_id": org_id,
            "status": {"$in": ["open", "assigned", "in_progress"]},
            "deleted_at": None,
        }
    ).count()

    pending_readings_pipeline = [
        {
            "$match": {
                "org_id": org_id,
                "deleted_at": None,
                "status": {"$nin": ["void"]},
                "line_items": {
                    "$elemMatch": {"type": "metered_utility", "status": "pending"}
                },
            }
        },
        {"$count": "total"},
    ]

    # Leases expiring within 30 days (active, end_date set)
    expiring_leases_pipeline = [
        {
            "$match": {
                "org_id": org_id,
                "deleted_at": None,
                "status": "active",
                "end_date": {
                    "$gte": today.isoformat(),
                    "$lte": expiry_horizon.isoformat(),
                },
            }
        },
        {"$count": "total"},
    ]

    overdue_invoices_pipeline = [
        {
            "$match": {
                "org_id": org_id,
                "deleted_at": None,
                "sandbox": False,
                "status": {"$in": ["overdue", "sent", "partial_paid", "ready", "draft"]},
                "due_date": {"$lt": today.isoformat()},
            }
        },
        {"$count": "total"},
    ]

    inv_col = Invoice.get_pymongo_collection()
    lease_col = Lease.get_pymongo_collection()

    open_tickets, pending_rows, expiring_rows, overdue_rows = await asyncio.gather(
        open_tickets_query,
        inv_col.aggregate(pending_readings_pipeline).to_list(length=None),
        lease_col.aggregate(expiring_leases_pipeline).to_list(length=None),
        inv_col.aggregate(overdue_invoices_pipeline).to_list(length=None),
    )

    return AlertCounts(
        open_tickets=open_tickets or 0,
        pending_meter_readings=pending_rows[0]["total"] if pending_rows else 0,
        leases_expiring_30d=expiring_rows[0]["total"] if expiring_rows else 0,
        overdue_invoices=overdue_rows[0]["total"] if overdue_rows else 0,
    )


async def _build_recent_payments(org_id: str) -> list[RecentPayment]:
    payments = await Payment.find(
        Payment.org_id == org_id,
        Payment.direction == "inbound",
        Payment.status == "completed",
        Payment.deleted_at == None,  # noqa: E711
    ).sort("-created_at").limit(5).to_list()

    result: list[RecentPayment] = []
    for p in payments:
        # Fetch tenant name; use cached field if possible, else query
        tenant_name = await _get_tenant_name(p.tenant_id, org_id)
        result.append(
            RecentPayment(
                id=str(p.id),
                tenant_name=tenant_name,
                amount=p.amount,
                method=p.method,
                payment_date=p.payment_date.isoformat(),
            )
        )
    return result


async def _build_recent_tickets(org_id: str) -> list[RecentTicket]:
    tickets = await Ticket.find(
        Ticket.org_id == org_id,
        Ticket.deleted_at == None,  # noqa: E711
    ).sort("-created_at").limit(5).to_list()

    return [
        RecentTicket(
            id=str(t.id),
            title=t.title,
            category=t.category,
            status=t.status,
            property_id=t.property_id,
            created_at=t.created_at.isoformat(),
        )
        for t in tickets
    ]


async def _build_collection_trend(org_id: str, today: date) -> list[CollectionTrendEntry]:
    # Last 6 months (oldest first)
    months: list[str] = []
    for i in range(5, -1, -1):
        d = _subtract_months(today, i)
        months.append(d.strftime("%Y-%m"))

    pipeline = [
        {
            "$match": {
                "org_id": org_id,
                "deleted_at": None,
                "sandbox": False,
                "status": {"$nin": ["void"]},
                "billing_month": {"$in": months},
            }
        },
        {
            "$group": {
                "_id": "$billing_month",
                "invoiced": {"$sum": "$total_amount"},
                "collected": {"$sum": "$amount_paid"},
            }
        },
    ]

    rows = await Invoice.get_pymongo_collection().aggregate(pipeline).to_list(length=None)
    by_month: dict[str, dict] = {r["_id"]: r for r in rows}

    result: list[CollectionTrendEntry] = []
    for m in months:
        row = by_month.get(m)
        invoiced = row["invoiced"] if row else 0.0
        collected = row["collected"] if row else 0.0
        rate = round(collected / invoiced * 100, 1) if invoiced else None
        result.append(CollectionTrendEntry(month=m, invoiced=invoiced, collected=collected, rate=rate))

    return result


async def _get_tenant_name(tenant_id: str, org_id: str) -> str:
    try:
        from beanie import PydanticObjectId
        user = await User.find_one(
            User.id == PydanticObjectId(tenant_id),
            User.org_id == org_id,
            User.deleted_at == None,  # noqa: E711
        )
        if user:
            return f"{user.first_name} {user.last_name}".strip() or user.email
        return "Unknown Tenant"
    except Exception:
        return "Unknown Tenant"


def _subtract_months(d: date, months: int) -> date:
    month = d.month - months
    year = d.year
    while month <= 0:
        month += 12
        year -= 1
    return d.replace(year=year, month=month, day=1)
