"""
Property reports — Rent Roll and future report types.
"""
import csv
import io
from datetime import date, datetime, timedelta
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.models.lease import Lease
from app.models.unit import Unit
from app.models.user import User
from app.repositories.property_repository import property_repository
from app.core.exceptions import ResourceNotFoundError

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/properties/{property_id}/reports", tags=["reports"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _days_remaining(end_date: Optional[date]) -> Optional[int]:
    if end_date is None:
        return None
    delta = (end_date - date.today()).days
    return delta


def _lease_health(lease: Lease, balance_due: float) -> str:
    """Simple health indicator for visual view."""
    if lease.status == "active":
        if balance_due > 0:
            return "overdue"
        end = lease.end_date
        if end and (end - date.today()).days <= 60:
            return "expiring_soon"
        return "healthy"
    if lease.status in ("expired", "terminated"):
        return "vacant"
    return lease.status


# ── Rent Roll data builder ────────────────────────────────────────────────────

async def _build_rent_roll(property_id: str, org_id: str) -> dict:
    from app.models.invoice import Invoice

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    # Fetch all units for property (no org_id filter needed — already scoped by property)
    units = await Unit.find(
        Unit.property_id == prop.id,
        Unit.deleted_at == None,  # noqa: E711
    ).sort("+unit_code").to_list()

    # Fetch all leases for property
    leases = await Lease.find(
        Lease.property_id == property_id,
        Lease.org_id == org_id,
        Lease.deleted_at == None,  # noqa: E711
    ).to_list()

    # Index active lease per unit (prefer active, fall back to latest)
    active_lease_by_unit: dict = {}
    for lease in sorted(leases, key=lambda l: l.created_at, reverse=True):
        uid = str(lease.unit_id)
        if uid not in active_lease_by_unit or lease.status == "active":
            active_lease_by_unit[uid] = lease

    # Fetch tenants for all active leases
    tenant_ids = list({l.tenant_id for l in active_lease_by_unit.values() if l.tenant_id})
    tenant_map: dict[str, User] = {}
    if tenant_ids:
        from bson import ObjectId as BsonObjectId
        from app.models.user import User as UserModel
        users = await UserModel.find(
            {"_id": {"$in": [BsonObjectId(tid) for tid in tenant_ids if len(tid) == 24]}}
        ).to_list()
        for u in users:
            tenant_map[str(u.id)] = u

    # Fetch latest invoice balance per lease
    lease_ids = [str(l.id) for l in active_lease_by_unit.values()]
    balance_by_lease: dict[str, float] = {}
    if lease_ids:
        invoices = await Invoice.find(
            {"lease_id": {"$in": lease_ids}, "org_id": org_id,
             "status": {"$nin": ["void"]}, "sandbox": False, "deleted_at": None,
             "invoice_category": "rent"}
        ).to_list()
        for inv in invoices:
            lid = str(inv.lease_id)
            balance_by_lease[lid] = balance_by_lease.get(lid, 0.0) + (inv.balance_due or 0.0)

    # Build rows — one per unit
    rows = []
    total_units = len(units)
    occupied = 0
    total_monthly_rent = 0.0
    total_balance_due = 0.0
    total_deposit_held = 0.0

    for unit in units:
        uid = str(unit.id)
        lease = active_lease_by_unit.get(uid)

        if lease and lease.status == "active":
            occupied += 1
            tenant = tenant_map.get(lease.tenant_id or "")
            tenant_name = (
                f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"
            )
            tenant_email = tenant.email if tenant else None
            tenant_phone = tenant.phone if tenant else None
            balance_due = balance_by_lease.get(str(lease.id), 0.0)
            total_monthly_rent += lease.rent_amount
            total_balance_due += balance_due
            total_deposit_held += lease.deposit_amount or 0.0
            health = _lease_health(lease, balance_due)
            rows.append({
                "unit_id": uid,
                "unit_code": unit.unit_code,
                "wing": unit.wing or "",
                "floor": unit.floor,
                "unit_type": unit.unit_type or "",
                "size": unit.size,
                "status": "occupied",
                "tenant_name": tenant_name,
                "tenant_email": tenant_email,
                "tenant_phone": tenant_phone,
                "lease_id": str(lease.id),
                "lease_status": lease.status,
                "lease_start": lease.start_date.isoformat() if lease.start_date else None,
                "lease_end": lease.end_date.isoformat() if lease.end_date else None,
                "days_remaining": _days_remaining(lease.end_date),
                "monthly_rent": lease.rent_amount,
                "deposit_held": lease.deposit_amount or 0.0,
                "utility_deposit": lease.utility_deposit or 0.0,
                "balance_due": round(balance_due, 2),
                "health": health,
            })
        else:
            rows.append({
                "unit_id": uid,
                "unit_code": unit.unit_code,
                "wing": unit.wing or "",
                "floor": unit.floor,
                "unit_type": unit.unit_type or "",
                "size": unit.size,
                "status": "vacant",
                "tenant_name": None,
                "tenant_email": None,
                "tenant_phone": None,
                "lease_id": None,
                "lease_status": None,
                "lease_start": None,
                "lease_end": None,
                "days_remaining": None,
                "monthly_rent": None,
                "deposit_held": 0.0,
                "utility_deposit": 0.0,
                "balance_due": 0.0,
                "health": "vacant",
            })

    occupancy_rate = round((occupied / total_units * 100), 1) if total_units else 0.0
    vacant = total_units - occupied

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_units": total_units,
            "occupied": occupied,
            "vacant": vacant,
            "occupancy_rate": occupancy_rate,
            "total_monthly_rent": round(total_monthly_rent, 2),
            "total_balance_due": round(total_balance_due, 2),
            "total_deposit_held": round(total_deposit_held, 2),
        },
        "rows": rows,
    }


# ── Collection Rate data builder ──────────────────────────────────────────────

def _month_range(months: int) -> list[str]:
    """Return list of YYYY-MM strings, oldest first, ending with current month."""
    today = date.today()
    y, m = today.year, today.month
    keys = []
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    keys.reverse()
    return keys


async def _build_collection_rate(property_id: str, org_id: str, months: int = 12) -> dict:
    from app.models.invoice import Invoice

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    month_keys = _month_range(months)

    invoices = await Invoice.find({
        "property_id": property_id,
        "org_id": org_id,
        "billing_month": {"$in": month_keys},
        "status": {"$nin": ["void", "draft"]},
        "sandbox": False,
        "deleted_at": None,
        "invoice_category": "rent",
    }).to_list()

    by_month: dict[str, list] = {k: [] for k in month_keys}
    for inv in invoices:
        if inv.billing_month in by_month:
            by_month[inv.billing_month].append(inv)

    rows = []
    agg_invoiced = 0.0
    agg_collected = 0.0
    agg_count = 0
    agg_paid = 0
    agg_on_time = 0

    for mk in month_keys:
        month_invs = by_month[mk]
        if not month_invs:
            rows.append({
                "billing_month": mk,
                "invoice_count": 0,
                "total_invoiced": 0.0,
                "total_collected": 0.0,
                "total_outstanding": 0.0,
                "paid_count": 0,
                "on_time_count": 0,
                "late_count": 0,
                "partial_count": 0,
                "unpaid_count": 0,
                "collection_rate": None,
                "on_time_rate": None,
            })
            continue

        invoiced = sum(inv.total_amount for inv in month_invs)
        collected = sum(inv.amount_paid for inv in month_invs)
        outstanding = sum(max(inv.balance_due, 0.0) for inv in month_invs)

        GRACE_DAYS = 7
        paid_count = on_time_count = late_count = partial_count = unpaid_count = 0
        for inv in month_invs:
            if inv.status == "paid":
                paid_count += 1
                if inv.paid_at and inv.due_date:
                    from datetime import timedelta
                    paid_date = inv.paid_at.date() if hasattr(inv.paid_at, "date") else inv.paid_at
                    if paid_date <= inv.due_date + timedelta(days=GRACE_DAYS):
                        on_time_count += 1
                    else:
                        late_count += 1
                else:
                    late_count += 1  # no paid_at → can't confirm on time
            elif inv.status == "partial_paid":
                partial_count += 1
            else:
                unpaid_count += 1

        n = len(month_invs)
        collection_rate = round(collected / invoiced * 100, 1) if invoiced > 0 else None
        # on_time_rate: % of fully-paid invoices settled within grace period
        on_time_rate = round(on_time_count / paid_count * 100, 1) if paid_count > 0 else None

        agg_invoiced += invoiced
        agg_collected += collected
        agg_count += n
        agg_paid += paid_count
        agg_on_time += on_time_count

        rows.append({
            "billing_month": mk,
            "invoice_count": n,
            "total_invoiced": round(invoiced, 2),
            "total_collected": round(collected, 2),
            "total_outstanding": round(outstanding, 2),
            "paid_count": paid_count,
            "on_time_count": on_time_count,
            "late_count": late_count,
            "partial_count": partial_count,
            "unpaid_count": unpaid_count,
            "collection_rate": collection_rate,
            "on_time_rate": on_time_rate,
        })

    overall_cr = round(agg_collected / agg_invoiced * 100, 1) if agg_invoiced > 0 else None
    overall_otr = round(agg_on_time / agg_paid * 100, 1) if agg_paid > 0 else None

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "period_months": months,
        "summary": {
            "total_invoiced": round(agg_invoiced, 2),
            "total_collected": round(agg_collected, 2),
            "total_outstanding": round(agg_invoiced - agg_collected, 2),
            "total_invoices": agg_count,
            "paid_invoices": agg_paid,
            "collection_rate": overall_cr,
            "on_time_rate": overall_otr,
        },
        "rows": rows,
    }


# ── Lease Expiry data builder ─────────────────────────────────────────────────

async def _build_lease_expiry(property_id: str, org_id: str, days: int = 90) -> dict:
    from bson import ObjectId as BsonObjectId

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    today = date.today()
    cutoff = today + timedelta(days=days)

    leases = await Lease.find(
        Lease.property_id == property_id,
        Lease.org_id == org_id,
        Lease.status == "active",
        Lease.deleted_at == None,  # noqa: E711
    ).to_list()

    leases = [l for l in leases if l.end_date and today <= l.end_date <= cutoff]

    # Fetch tenants
    tenant_ids = list({str(l.tenant_id) for l in leases if l.tenant_id})
    tenant_map: dict = {}
    if tenant_ids:
        from app.models.user import User as UserModel
        users = await UserModel.find(
            {"_id": {"$in": [BsonObjectId(t) for t in tenant_ids if len(t) == 24]}}
        ).to_list()
        for u in users:
            tenant_map[str(u.id)] = u

    # Fetch units
    unit_ids = list({str(l.unit_id) for l in leases if l.unit_id})
    unit_map: dict = {}
    if unit_ids:
        units = await Unit.find(
            {"_id": {"$in": [BsonObjectId(u) for u in unit_ids if len(u) == 24]}}
        ).to_list()
        for u in units:
            unit_map[str(u.id)] = u

    rows = []
    for lease in leases:
        days_remaining = (lease.end_date - today).days
        urgency = "critical" if days_remaining <= 30 else "warning" if days_remaining <= 60 else "notice"
        tenant = tenant_map.get(str(lease.tenant_id) if lease.tenant_id else "")
        unit = unit_map.get(str(lease.unit_id) if lease.unit_id else "")
        tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"

        rows.append({
            "lease_id": str(lease.id),
            "tenant_id": str(lease.tenant_id) if lease.tenant_id else None,
            "tenant_name": tenant_name,
            "tenant_email": tenant.email if tenant else None,
            "tenant_phone": getattr(tenant, "phone", None) if tenant else None,
            "unit_id": str(lease.unit_id) if lease.unit_id else None,
            "unit_code": unit.unit_code if unit else "—",
            "unit_type": getattr(unit, "unit_type", None) if unit else None,
            "lease_start": lease.start_date.isoformat() if lease.start_date else None,
            "lease_end": lease.end_date.isoformat(),
            "days_remaining": days_remaining,
            "urgency": urgency,
            "monthly_rent": lease.rent_amount,
            "deposit_amount": lease.deposit_amount or 0.0,
        })

    rows.sort(key=lambda r: r["days_remaining"])

    critical = [r for r in rows if r["urgency"] == "critical"]
    warning = [r for r in rows if r["urgency"] == "warning"]
    notice = [r for r in rows if r["urgency"] == "notice"]

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "window_days": days,
        "summary": {
            "total": len(rows),
            "critical": len(critical),
            "warning": len(warning),
            "notice": len(notice),
            "total_rent_at_risk": round(sum(r["monthly_rent"] for r in rows), 2),
        },
        "rows": rows,
    }


# ── Payment Behavior data builder ────────────────────────────────────────────

def _reliability_score(on_time_rate: float, avg_delay: float, paid_rate: float) -> int:
    """0-100 score. 60% on-time rate + 30% delay component + 10% paid rate."""
    delay_score = max(0.0, 100.0 - avg_delay * 3)  # -3 pts per avg day late
    raw = on_time_rate * 0.6 + delay_score * 0.3 + paid_rate * 0.1
    return int(round(min(100.0, max(0.0, raw))))


async def _build_payment_behavior(property_id: str, org_id: str) -> dict:
    from collections import defaultdict
    from app.models.invoice import Invoice
    from bson import ObjectId as BsonObjectId

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    today = date.today()

    invoices = await Invoice.find({
        "property_id": property_id,
        "org_id": org_id,
        "status": {"$nin": ["void", "draft"]},
        "sandbox": False,
        "deleted_at": None,
        "invoice_category": "rent",
    }).to_list()

    # Fetch tenants
    tenant_ids = list({str(inv.tenant_id) for inv in invoices if inv.tenant_id})
    tenant_map: dict = {}
    if tenant_ids:
        from app.models.user import User as UserModel
        users = await UserModel.find(
            {"_id": {"$in": [BsonObjectId(t) for t in tenant_ids if len(t) == 24]}}
        ).to_list()
        for u in users:
            tenant_map[str(u.id)] = u

    # Fetch units
    unit_ids = list({str(inv.unit_id) for inv in invoices if inv.unit_id})
    unit_map: dict = {}
    if unit_ids:
        units = await Unit.find(
            {"_id": {"$in": [BsonObjectId(u) for u in unit_ids if len(u) == 24]}}
        ).to_list()
        for u in units:
            unit_map[str(u.id)] = u

    by_tenant: dict = defaultdict(list)
    for inv in invoices:
        tid = str(inv.tenant_id) if inv.tenant_id else "unknown"
        by_tenant[tid].append(inv)

    rows = []
    for tid, tenant_invs in by_tenant.items():
        tenant = tenant_map.get(tid)
        tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"

        latest_inv = max(tenant_invs, key=lambda i: i.billing_month)
        unit = unit_map.get(str(latest_inv.unit_id) if latest_inv.unit_id else "")

        total = len(tenant_invs)
        paid_invs = [inv for inv in tenant_invs if inv.status == "paid"]
        partial_invs = [inv for inv in tenant_invs if inv.status == "partial_paid"]

        on_time_count = 0
        delays: list[int] = []
        last_paid_dt = None

        for inv in paid_invs:
            if inv.paid_at:
                paid_date = inv.paid_at.date() if hasattr(inv.paid_at, "date") else inv.paid_at
                if last_paid_dt is None or paid_date > last_paid_dt:
                    last_paid_dt = paid_date
                if inv.due_date:
                    delay = (paid_date - inv.due_date).days
                    delays.append(delay)
                    if delay <= 0:
                        on_time_count += 1
                else:
                    delays.append(0)
                    on_time_count += 1
            else:
                delays.append(0)
                on_time_count += 1  # no paid_at recorded → assume on time

        paid_count = len(paid_invs)
        partial_count = len(partial_invs)
        unpaid_count = total - paid_count - partial_count

        avg_delay = round(sum(max(0, d) for d in delays) / len(delays), 1) if delays else None
        on_time_rate = round(on_time_count / paid_count * 100, 1) if paid_count > 0 else None
        paid_rate = paid_count / total * 100 if total > 0 else 0.0

        score: Optional[int] = None
        if paid_count > 0:
            score = _reliability_score(on_time_rate or 0.0, avg_delay or 0.0, paid_rate)

        outstanding = round(sum(inv.balance_due for inv in tenant_invs if inv.balance_due > 0), 2)

        rows.append({
            "tenant_id": tid,
            "tenant_name": tenant_name,
            "tenant_email": tenant.email if tenant else None,
            "tenant_phone": getattr(tenant, "phone", None) if tenant else None,
            "unit_id": str(latest_inv.unit_id) if latest_inv.unit_id else None,
            "unit_code": unit.unit_code if unit else "—",
            "total_invoices": total,
            "paid_count": paid_count,
            "partial_count": partial_count,
            "unpaid_count": unpaid_count,
            "on_time_count": on_time_count,
            "avg_payment_delay_days": avg_delay,
            "on_time_rate": on_time_rate,
            "reliability_score": score,
            "last_payment_date": last_paid_dt.isoformat() if last_paid_dt else None,
            "outstanding_balance": outstanding,
        })

    # Worst first (None scores at the end)
    rows.sort(key=lambda r: (r["reliability_score"] is None, r["reliability_score"] or 0))

    scored = [r for r in rows if r["reliability_score"] is not None]
    avg_score = round(sum(r["reliability_score"] for r in scored) / len(scored), 1) if scored else None

    scored_otr = [r for r in rows if r["on_time_rate"] is not None]
    avg_otr = round(sum(r["on_time_rate"] for r in scored_otr) / len(scored_otr), 1) if scored_otr else None

    scored_delay = [r for r in rows if r["avg_payment_delay_days"] is not None]
    avg_delay_all = round(sum(r["avg_payment_delay_days"] for r in scored_delay) / len(scored_delay), 1) if scored_delay else None

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "tenant_count": len(rows),
            "avg_reliability_score": avg_score,
            "avg_on_time_rate": avg_otr,
            "avg_payment_delay_days": avg_delay_all,
            "excellent_count": sum(1 for r in scored if r["reliability_score"] >= 80),
            "good_count": sum(1 for r in scored if 60 <= r["reliability_score"] < 80),
            "poor_count": sum(1 for r in scored if r["reliability_score"] < 60),
        },
        "rows": rows,
    }


# ── Outstanding Balances data builder ────────────────────────────────────────

async def _build_outstanding_balances(property_id: str, org_id: str) -> dict:
    from collections import defaultdict
    from app.models.invoice import Invoice
    from app.models.payment import Payment
    from bson import ObjectId as BsonObjectId

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    today = date.today()

    invoices = await Invoice.find({
        "property_id": property_id,
        "org_id": org_id,
        "balance_due": {"$gt": 0},
        "status": {"$nin": ["void", "draft"]},
        "sandbox": False,
        "deleted_at": None,
        "invoice_category": "rent",
    }).to_list()

    # Fetch tenants
    tenant_ids = list({str(inv.tenant_id) for inv in invoices if inv.tenant_id})
    tenant_map: dict = {}
    if tenant_ids:
        from app.models.user import User as UserModel
        users = await UserModel.find(
            {"_id": {"$in": [BsonObjectId(t) for t in tenant_ids if len(t) == 24]}}
        ).to_list()
        for u in users:
            tenant_map[str(u.id)] = u

    # Fetch units
    unit_ids = list({str(inv.unit_id) for inv in invoices if inv.unit_id})
    unit_map: dict = {}
    if unit_ids:
        units = await Unit.find(
            {"_id": {"$in": [BsonObjectId(u) for u in unit_ids if len(u) == 24]}}
        ).to_list()
        for u in units:
            unit_map[str(u.id)] = u

    # Last payment date per tenant via Payment records linked to these invoices
    invoice_ids = [str(inv.id) for inv in invoices]
    inv_to_tenant: dict = {
        str(inv.id): str(inv.tenant_id) if inv.tenant_id else None for inv in invoices
    }
    last_payment_by_tenant: dict = {}
    if invoice_ids:
        payments = await Payment.find(
            {"invoice_id": {"$in": invoice_ids}, "org_id": org_id}
        ).to_list()
        for pay in payments:
            tid = inv_to_tenant.get(str(pay.invoice_id) if pay.invoice_id else "")
            if tid and pay.payment_date:
                pd = pay.payment_date if isinstance(pay.payment_date, date) else pay.payment_date.date()
                if tid not in last_payment_by_tenant or pd > last_payment_by_tenant[tid]:
                    last_payment_by_tenant[tid] = pd

    # Group invoices by tenant
    by_tenant: dict = defaultdict(list)
    for inv in invoices:
        tid = str(inv.tenant_id) if inv.tenant_id else "unknown"
        by_tenant[tid].append(inv)

    rows = []
    for tid, tenant_invs in by_tenant.items():
        tenant = tenant_map.get(tid)
        tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"

        latest_inv = max(tenant_invs, key=lambda i: i.billing_month)
        unit = unit_map.get(str(latest_inv.unit_id) if latest_inv.unit_id else "")

        total_balance = round(sum(inv.balance_due for inv in tenant_invs), 2)
        total_invoiced = round(sum(inv.total_amount for inv in tenant_invs), 2)
        total_paid = round(sum(inv.amount_paid for inv in tenant_invs), 2)

        overdue_invs = [inv for inv in tenant_invs if inv.due_date and inv.due_date < today]
        oldest_due = min((inv.due_date for inv in overdue_invs), default=None)
        max_days_overdue = (today - oldest_due).days if oldest_due else 0

        last_pay = last_payment_by_tenant.get(tid)

        rows.append({
            "tenant_id": tid,
            "tenant_name": tenant_name,
            "tenant_email": tenant.email if tenant else None,
            "tenant_phone": getattr(tenant, "phone", None) if tenant else None,
            "unit_id": str(latest_inv.unit_id) if latest_inv.unit_id else None,
            "unit_code": unit.unit_code if unit else "—",
            "invoice_count": len(tenant_invs),
            "overdue_invoice_count": len(overdue_invs),
            "oldest_billing_month": min(inv.billing_month for inv in tenant_invs),
            "oldest_due_date": oldest_due.isoformat() if oldest_due else None,
            "max_days_overdue": max_days_overdue,
            "total_invoiced": total_invoiced,
            "total_paid": total_paid,
            "total_balance": total_balance,
            "last_payment_date": last_pay.isoformat() if last_pay else None,
        })

    rows.sort(key=lambda r: r["total_balance"], reverse=True)

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_outstanding": round(sum(r["total_balance"] for r in rows), 2),
            "tenant_count": len(rows),
            "invoice_count": sum(r["invoice_count"] for r in rows),
            "never_paid_count": sum(1 for r in rows if not r["last_payment_date"]),
            "avg_days_overdue": round(
                sum(r["max_days_overdue"] for r in rows) / len(rows), 1
            ) if rows else 0,
        },
        "rows": rows,
    }


# ── Arrears data builder ──────────────────────────────────────────────────────

def _bucket(days: int) -> str:
    if days <= 30:
        return "0_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "90_plus"


async def _build_arrears(property_id: str, org_id: str) -> dict:
    from app.models.invoice import Invoice
    from bson import ObjectId as BsonObjectId

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    today = date.today()

    all_outstanding = await Invoice.find({
        "property_id": property_id,
        "org_id": org_id,
        "balance_due": {"$gt": 0},
        "status": {"$nin": ["void", "draft"]},
        "sandbox": False,
        "deleted_at": None,
        "invoice_category": "rent",
    }).to_list()

    # Only include invoices whose due_date has actually passed — anything not yet
    # due is not "arrears"; it's just an outstanding current invoice.
    invoices = [inv for inv in all_outstanding if inv.due_date and inv.due_date < today]

    # Fetch tenants
    tenant_ids = list({str(inv.tenant_id) for inv in invoices if inv.tenant_id})
    tenant_map: dict = {}
    if tenant_ids:
        from app.models.user import User as UserModel
        users = await UserModel.find(
            {"_id": {"$in": [BsonObjectId(t) for t in tenant_ids if len(t) == 24]}}
        ).to_list()
        for u in users:
            tenant_map[str(u.id)] = u

    # Fetch units
    unit_ids = list({str(inv.unit_id) for inv in invoices if inv.unit_id})
    unit_map: dict = {}
    if unit_ids:
        units = await Unit.find(
            {"_id": {"$in": [BsonObjectId(u) for u in unit_ids if len(u) == 24]}}
        ).to_list()
        for u in units:
            unit_map[str(u.id)] = u

    rows = []
    for inv in invoices:
        due = inv.due_date
        days_overdue = (today - due).days  # always positive since due < today guaranteed above
        bucket = _bucket(days_overdue)

        tenant = tenant_map.get(str(inv.tenant_id) if inv.tenant_id else "")
        unit = unit_map.get(str(inv.unit_id) if inv.unit_id else "")
        tenant_name = (
            f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"
        )

        rows.append({
            "invoice_id": str(inv.id),
            "reference_no": inv.reference_no,
            "tenant_id": str(inv.tenant_id) if inv.tenant_id else None,
            "tenant_name": tenant_name,
            "tenant_email": tenant.email if tenant else None,
            "tenant_phone": getattr(tenant, "phone", None) if tenant else None,
            "unit_id": str(inv.unit_id) if inv.unit_id else None,
            "unit_code": unit.unit_code if unit else "—",
            "billing_month": inv.billing_month,
            "due_date": due.isoformat() if due else None,
            "days_overdue": days_overdue,
            "bucket": bucket,
            "total_amount": round(inv.total_amount, 2),
            "amount_paid": round(inv.amount_paid, 2),
            "balance_due": round(inv.balance_due, 2),
            "status": inv.status,
        })

    rows.sort(key=lambda r: r["days_overdue"], reverse=True)

    def _bucket_summary(key: str) -> dict:
        bucket_rows = [r for r in rows if r["bucket"] == key]
        return {
            "count": len(bucket_rows),
            "balance": round(sum(r["balance_due"] for r in bucket_rows), 2),
        }

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_overdue_balance": round(sum(r["balance_due"] for r in rows), 2),
            "total_invoices": len(rows),
            "bucket_0_30":   _bucket_summary("0_30"),
            "bucket_31_60":  _bucket_summary("31_60"),
            "bucket_61_90":  _bucket_summary("61_90"),
            "bucket_90_plus": _bucket_summary("90_plus"),
        },
        "rows": rows,
    }


# ── API endpoints ─────────────────────────────────────────────────────────────

@router.get("/rent-roll")
async def get_rent_roll(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_rent_roll(property_id, current_user.org_id)
    return data


@router.get("/rent-roll/export")
async def export_rent_roll(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv | txt"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_rent_roll(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Unit", "Wing", "Floor", "Type", "Size (sqft)",
        "Status", "Tenant Name", "Tenant Phone", "Tenant Email",
        "Lease Start", "Lease End", "Days Remaining",
        "Monthly Rent (KSh)", "Deposit Held (KSh)", "Utility Deposit (KSh)",
        "Balance Due (KSh)", "Health",
    ]

    output = io.StringIO()
    # BOM for Excel compatibility with CSV
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    # Report header block
    writer.writerow(["Rent Roll Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    s = data["summary"]
    writer.writerow(["Total Units:", s["total_units"], "Occupied:", s["occupied"],
                     "Vacant:", s["vacant"], "Occupancy Rate:", f"{s['occupancy_rate']}%"])
    writer.writerow(["Total Monthly Rent:", s["total_monthly_rent"],
                     "Balance Due:", s["total_balance_due"],
                     "Deposits Held:", s["total_deposit_held"]])
    writer.writerow([])
    writer.writerow(headers)

    for row in data["rows"]:
        writer.writerow([
            row["unit_code"],
            row["wing"],
            row["floor"] or "",
            row["unit_type"],
            row["size"] or "",
            row["status"],
            row["tenant_name"] or "",
            row["tenant_phone"] or "",
            row["tenant_email"] or "",
            row["lease_start"] or "",
            row["lease_end"] or "",
            row["days_remaining"] if row["days_remaining"] is not None else "",
            row["monthly_rent"] if row["monthly_rent"] is not None else "",
            row["deposit_held"],
            row["utility_deposit"],
            row["balance_due"],
            row["health"],
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"rent_roll_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/arrears")
async def get_arrears(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_arrears(property_id, current_user.org_id)
    return data


@router.get("/arrears/export")
async def export_arrears(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_arrears(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Reference No", "Unit", "Tenant Name", "Tenant Phone", "Tenant Email",
        "Billing Month", "Due Date", "Days Overdue", "Bucket",
        "Total Amount (KSh)", "Amount Paid (KSh)", "Balance Due (KSh)", "Status",
    ]

    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Arrears Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Total Overdue Balance:", s["total_overdue_balance"],
                     "Total Invoices:", s["total_invoices"]])
    writer.writerow(["0-30 days:", s["bucket_0_30"]["count"], "invoices,",
                     s["bucket_0_30"]["balance"],
                     "| 31-60 days:", s["bucket_31_60"]["count"], "invoices,",
                     s["bucket_31_60"]["balance"],
                     "| 61-90 days:", s["bucket_61_90"]["count"], "invoices,",
                     s["bucket_61_90"]["balance"],
                     "| 90+ days:", s["bucket_90_plus"]["count"], "invoices,",
                     s["bucket_90_plus"]["balance"]])
    writer.writerow([])
    writer.writerow(headers)

    bucket_labels = {
        "0_30": "0-30 days", "31_60": "31-60 days",
        "61_90": "61-90 days", "90_plus": "90+ days",
    }
    for row in data["rows"]:
        writer.writerow([
            row["reference_no"],
            row["unit_code"],
            row["tenant_name"],
            row["tenant_phone"] or "",
            row["tenant_email"] or "",
            row["billing_month"],
            row["due_date"] or "",
            row["days_overdue"],
            bucket_labels.get(row["bucket"], row["bucket"]),
            row["total_amount"],
            row["amount_paid"],
            row["balance_due"],
            row["status"],
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"arrears_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/collection-rate")
async def get_collection_rate(
    property_id: str,
    months: int = Query(default=12, ge=1, le=24, description="Number of months to include"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_collection_rate(property_id, current_user.org_id, months)
    return data


@router.get("/collection-rate/export")
async def export_collection_rate(
    property_id: str,
    months: int = Query(default=12, ge=1, le=24),
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_collection_rate(property_id, current_user.org_id, months)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Billing Month", "Invoices", "Total Invoiced (KSh)", "Total Collected (KSh)",
        "Outstanding (KSh)", "Paid Count", "On-Time Count", "Late Count",
        "Partial Count", "Unpaid Count", "Collection Rate (%)", "On-Time Rate (%)",
    ]

    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Collection Rate Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Period:", f"Last {data['period_months']} months"])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Overall Collection Rate:", f"{s['collection_rate']}%" if s["collection_rate"] is not None else "N/A",
                     "On-Time Rate:", f"{s['on_time_rate']}%" if s["on_time_rate"] is not None else "N/A"])
    writer.writerow(["Total Invoiced:", s["total_invoiced"],
                     "Total Collected:", s["total_collected"],
                     "Outstanding:", s["total_outstanding"]])
    writer.writerow([])
    writer.writerow(headers)

    for row in data["rows"]:
        writer.writerow([
            row["billing_month"],
            row["invoice_count"],
            row["total_invoiced"],
            row["total_collected"],
            row["total_outstanding"],
            row["paid_count"],
            row["on_time_count"],
            row["late_count"],
            row["partial_count"],
            row["unpaid_count"],
            row["collection_rate"] if row["collection_rate"] is not None else "",
            row["on_time_rate"] if row["on_time_rate"] is not None else "",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"collection_rate_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/outstanding-balances")
async def get_outstanding_balances(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_outstanding_balances(property_id, current_user.org_id)
    return data


@router.get("/outstanding-balances/export")
async def export_outstanding_balances(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_outstanding_balances(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Tenant Name", "Tenant Phone", "Tenant Email", "Unit",
        "Invoices", "Overdue Invoices", "Oldest Due Date", "Days Overdue",
        "Total Invoiced (KSh)", "Total Paid (KSh)", "Balance Due (KSh)",
        "Last Payment Date",
    ]

    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Outstanding Balances Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Total Outstanding:", s["total_outstanding"],
                     "Tenants:", s["tenant_count"],
                     "Invoices:", s["invoice_count"],
                     "Never Paid:", s["never_paid_count"]])
    writer.writerow([])
    writer.writerow(headers)

    for row in data["rows"]:
        writer.writerow([
            row["tenant_name"],
            row["tenant_phone"] or "",
            row["tenant_email"] or "",
            row["unit_code"],
            row["invoice_count"],
            row["overdue_invoice_count"],
            row["oldest_due_date"] or "",
            row["max_days_overdue"],
            row["total_invoiced"],
            row["total_paid"],
            row["total_balance"],
            row["last_payment_date"] or "Never",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"outstanding_balances_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/lease-expiry")
async def get_lease_expiry(
    property_id: str,
    days: int = Query(default=90, ge=7, le=365, description="Lookahead window in days"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_lease_expiry(property_id, current_user.org_id, days)
    return data


@router.get("/lease-expiry/export")
async def export_lease_expiry(
    property_id: str,
    days: int = Query(default=90, ge=7, le=365),
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_lease_expiry(property_id, current_user.org_id, days)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Unit", "Unit Type", "Tenant Name", "Tenant Phone", "Tenant Email",
        "Lease Start", "Lease End", "Days Remaining", "Urgency",
        "Monthly Rent (KSh)", "Deposit (KSh)",
    ]

    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Lease Expiry Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Window:", f"Next {data['window_days']} days"])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Total Expiring:", s["total"],
                     "Critical (≤30d):", s["critical"],
                     "Warning (31-60d):", s["warning"],
                     "Notice (61-90d):", s["notice"],
                     "Rent at Risk:", s["total_rent_at_risk"]])
    writer.writerow([])
    writer.writerow(headers)

    urgency_labels = {"critical": "Critical (≤30d)", "warning": "Warning (31-60d)", "notice": "Notice (61-90d)"}
    for row in data["rows"]:
        writer.writerow([
            row["unit_code"],
            row["unit_type"] or "",
            row["tenant_name"],
            row["tenant_phone"] or "",
            row["tenant_email"] or "",
            row["lease_start"] or "",
            row["lease_end"],
            row["days_remaining"],
            urgency_labels.get(row["urgency"], row["urgency"]),
            row["monthly_rent"],
            row["deposit_amount"],
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"lease_expiry_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payment-behavior")
async def get_payment_behavior(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_payment_behavior(property_id, current_user.org_id)
    return data


@router.get("/payment-behavior/export")
async def export_payment_behavior(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_payment_behavior(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","

    headers = [
        "Tenant Name", "Tenant Phone", "Tenant Email", "Unit",
        "Total Invoices", "Paid", "Partial", "Unpaid", "On-Time",
        "Avg Delay (days)", "On-Time Rate (%)", "Reliability Score",
        "Outstanding (KSh)", "Last Payment Date",
    ]

    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")

    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Tenant Payment Behavior Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Avg Reliability Score:", s["avg_reliability_score"] if s["avg_reliability_score"] is not None else "N/A",
                     "Avg On-Time Rate:", f"{s['avg_on_time_rate']}%" if s["avg_on_time_rate"] is not None else "N/A",
                     "Avg Delay:", f"{s['avg_payment_delay_days']}d" if s["avg_payment_delay_days"] is not None else "N/A"])
    writer.writerow(["Excellent (≥80):", s["excellent_count"],
                     "Good (60-79):", s["good_count"],
                     "Poor (<60):", s["poor_count"]])
    writer.writerow([])
    writer.writerow(headers)

    for row in data["rows"]:
        writer.writerow([
            row["tenant_name"],
            row["tenant_phone"] or "",
            row["tenant_email"] or "",
            row["unit_code"],
            row["total_invoices"],
            row["paid_count"],
            row["partial_count"],
            row["unpaid_count"],
            row["on_time_count"],
            row["avg_payment_delay_days"] if row["avg_payment_delay_days"] is not None else "",
            row["on_time_rate"] if row["on_time_rate"] is not None else "",
            row["reliability_score"] if row["reliability_score"] is not None else "",
            row["outstanding_balance"],
            row["last_payment_date"] or "Never",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"payment_behavior_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ── Occupancy data builder ────────────────────────────────────────────────────

async def _build_occupancy(property_id: str, org_id: str) -> dict:
    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property not found")

    units = await Unit.find(
        {"property_id": prop.id, "org_id": org_id, "deleted_at": None}
    ).to_list()

    # Fetch active leases to get tenant mapping per unit
    leases = await Lease.find(
        {
            "property_id": str(prop.id),
            "org_id": org_id,
            "status": "active",
            "deleted_at": None,
        }
    ).to_list()

    lease_by_unit: dict[str, Lease] = {}
    tenant_ids: list[str] = []
    for lease in leases:
        if lease.unit_id:
            lease_by_unit[str(lease.unit_id)] = lease
        if lease.tenant_id:
            tenant_ids.append(str(lease.tenant_id))

    # Fetch tenant names
    from bson import ObjectId as BsonObjectId
    valid_oids = []
    for tid in tenant_ids:
        try:
            valid_oids.append(BsonObjectId(tid))
        except Exception:
            pass

    tenant_map: dict[str, str] = {}
    if valid_oids:
        tenant_docs = await User.find({"_id": {"$in": valid_oids}}).to_list()
        for t in tenant_docs:
            tenant_map[str(t.id)] = f"{t.first_name} {t.last_name}"

    # Build unit rows
    rows = []
    for u in units:
        uid = str(u.id)
        lease = lease_by_unit.get(uid)
        tenant_name = None
        monthly_rent = None
        lease_end = None
        if lease:
            tenant_name = tenant_map.get(str(lease.tenant_id)) if lease.tenant_id else None
            monthly_rent = lease.rent_amount
            lease_end = lease.end_date.isoformat() if lease.end_date else None

        rows.append({
            "unit_id": uid,
            "unit_code": u.unit_code,
            "wing": u.wing or "—",
            "floor": u.floor,
            "unit_type": u.unit_type,
            "size": u.size,
            "status": u.status,  # occupied | vacant | reserved | booked | inactive
            "tenant_name": tenant_name,
            "monthly_rent": monthly_rent,
            "lease_end": lease_end,
        })

    rows.sort(key=lambda r: (r["wing"], r["floor"], r["unit_code"]))

    # Helper: count occupied units (leased = occupied or booked)
    def is_occupied(status: str) -> bool:
        return status in ("occupied", "booked", "reserved")

    total = len(rows)
    occ_count = sum(1 for r in rows if is_occupied(r["status"]))
    vac_count = total - occ_count
    occ_rate = round((occ_count / total * 100), 1) if total else None

    # By wing
    wings: dict[str, dict] = {}
    for r in rows:
        w = r["wing"]
        if w not in wings:
            wings[w] = {"wing": w, "total": 0, "occupied": 0, "vacant": 0}
        wings[w]["total"] += 1
        if is_occupied(r["status"]):
            wings[w]["occupied"] += 1
        else:
            wings[w]["vacant"] += 1
    for w in wings.values():
        w["occupancy_rate"] = round(w["occupied"] / w["total"] * 100, 1) if w["total"] else None
    by_wing = sorted(wings.values(), key=lambda x: x["wing"])

    # By floor
    floors: dict[int, dict] = {}
    for r in rows:
        f = r["floor"]
        if f not in floors:
            floors[f] = {"floor": f, "total": 0, "occupied": 0, "vacant": 0}
        floors[f]["total"] += 1
        if is_occupied(r["status"]):
            floors[f]["occupied"] += 1
        else:
            floors[f]["vacant"] += 1
    for f in floors.values():
        f["occupancy_rate"] = round(f["occupied"] / f["total"] * 100, 1) if f["total"] else None
    by_floor = sorted(floors.values(), key=lambda x: x["floor"])

    # By unit type
    types: dict[str, dict] = {}
    for r in rows:
        t = r["unit_type"]
        if t not in types:
            types[t] = {"unit_type": t, "total": 0, "occupied": 0, "vacant": 0}
        types[t]["total"] += 1
        if is_occupied(r["status"]):
            types[t]["occupied"] += 1
        else:
            types[t]["vacant"] += 1
    for t in types.values():
        t["occupancy_rate"] = round(t["occupied"] / t["total"] * 100, 1) if t["total"] else None
    by_type = sorted(types.values(), key=lambda x: -x["total"])

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_units": total,
            "occupied": occ_count,
            "vacant": vac_count,
            "occupancy_rate": occ_rate,
        },
        "by_wing": by_wing,
        "by_floor": by_floor,
        "by_type": by_type,
        "rows": rows,
    }


# ── Occupancy endpoints ───────────────────────────────────────────────────────

@router.get("/occupancy")
async def get_occupancy(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await _build_occupancy(property_id, current_user.org_id)


@router.get("/occupancy/export")
async def export_occupancy(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_occupancy(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","
    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")
    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Occupancy Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow(["Total Units:", s["total_units"], "Occupied:", s["occupied"],
                     "Vacant:", s["vacant"], "Occupancy Rate:", f"{s['occupancy_rate']}%" if s["occupancy_rate"] is not None else "N/A"])
    writer.writerow([])

    # By wing
    writer.writerow(["BY WING"])
    writer.writerow(["Wing", "Total", "Occupied", "Vacant", "Occupancy Rate (%)"])
    for row in data["by_wing"]:
        writer.writerow([row["wing"], row["total"], row["occupied"], row["vacant"],
                         row["occupancy_rate"] if row["occupancy_rate"] is not None else ""])
    writer.writerow([])

    # By floor
    writer.writerow(["BY FLOOR"])
    writer.writerow(["Floor", "Total", "Occupied", "Vacant", "Occupancy Rate (%)"])
    for row in data["by_floor"]:
        writer.writerow([row["floor"], row["total"], row["occupied"], row["vacant"],
                         row["occupancy_rate"] if row["occupancy_rate"] is not None else ""])
    writer.writerow([])

    # By unit type
    writer.writerow(["BY UNIT TYPE"])
    writer.writerow(["Unit Type", "Total", "Occupied", "Vacant", "Occupancy Rate (%)"])
    for row in data["by_type"]:
        writer.writerow([row["unit_type"], row["total"], row["occupied"], row["vacant"],
                         row["occupancy_rate"] if row["occupancy_rate"] is not None else ""])
    writer.writerow([])

    # Unit detail
    writer.writerow(["UNIT DETAIL"])
    writer.writerow(["Unit Code", "Wing", "Floor", "Unit Type", "Size (m²)", "Status",
                     "Tenant", "Monthly Rent", "Lease End"])
    for row in data["rows"]:
        writer.writerow([
            row["unit_code"], row["wing"], row["floor"], row["unit_type"],
            row["size"] or "", row["status"],
            row["tenant_name"] or "",
            row["monthly_rent"] or "",
            row["lease_end"] or "",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"occupancy_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ── Vacancy Detail data builder ───────────────────────────────────────────────

async def _build_vacancy_detail(property_id: str, org_id: str) -> dict:
    from bson import ObjectId as BsonObjectId

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property not found")

    # All non-occupied units
    vacant_units = await Unit.find(
        {
            "property_id": prop.id,
            "org_id": org_id,
            "status": {"$in": ["vacant", "inactive"]},
            "deleted_at": None,
        }
    ).to_list()

    if not vacant_units:
        return {
            "property_id": property_id,
            "property_name": prop.name,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "summary": {
                "total_vacant": 0,
                "total_inactive": 0,
                "never_leased": 0,
                "avg_days_vacant": None,
                "total_estimated_loss": 0.0,
            },
            "rows": [],
        }

    unit_ids = [str(u.id) for u in vacant_units]

    # For each vacant unit find most recent terminated/expired lease
    all_past_leases = await Lease.find(
        {
            "property_id": str(prop.id),
            "org_id": org_id,
            "unit_id": {"$in": unit_ids},
            "status": {"$in": ["expired", "terminated", "cancelled"]},
            "deleted_at": None,
        }
    ).to_list()

    # Group by unit_id → keep latest
    latest_lease: dict[str, Lease] = {}
    for lease in all_past_leases:
        uid = lease.unit_id
        existing = latest_lease.get(uid)
        if existing is None:
            latest_lease[uid] = lease
        else:
            # Compare by end_date (prefer latest)
            def _lease_end(l: Lease) -> date:
                return l.end_date if l.end_date else date(2000, 1, 1)
            if _lease_end(lease) > _lease_end(existing):
                latest_lease[uid] = lease

    # Collect tenant ids to resolve names
    tenant_ids = []
    for lease in latest_lease.values():
        if lease.tenant_id:
            tenant_ids.append(lease.tenant_id)

    valid_oids = []
    for tid in tenant_ids:
        try:
            valid_oids.append(BsonObjectId(tid))
        except Exception:
            pass

    tenant_map: dict[str, User] = {}
    if valid_oids:
        tenant_docs = await User.find({"_id": {"$in": valid_oids}}).to_list()
        for t in tenant_docs:
            tenant_map[str(t.id)] = t

    today = date.today()
    rows = []
    for u in vacant_units:
        uid = str(u.id)
        lease = latest_lease.get(uid)

        last_tenant_name = None
        last_tenant_phone = None
        last_tenant_email = None
        last_lease_end = None
        last_rent = u.rent_base  # fall back to unit base rent if no lease history

        if lease:
            t = tenant_map.get(lease.tenant_id) if lease.tenant_id else None
            if t:
                last_tenant_name = t.full_name
                last_tenant_phone = getattr(t, "phone", None)
                last_tenant_email = t.email
            last_lease_end = lease.end_date.isoformat() if lease.end_date else None
            last_rent = lease.rent_amount

        # Days vacant: from last lease end_date or unit created_at
        if lease and lease.end_date:
            days_vacant = (today - lease.end_date).days
        else:
            days_vacant = (today - u.created_at.date()).days

        days_vacant = max(0, days_vacant)

        # Estimated rent loss (pro-rated monthly → daily)
        estimated_loss = None
        if last_rent:
            estimated_loss = round((days_vacant / 30.0) * last_rent, 2)

        rows.append({
            "unit_id": uid,
            "unit_code": u.unit_code,
            "wing": u.wing or "—",
            "floor": u.floor,
            "unit_type": u.unit_type,
            "size": u.size,
            "status": u.status,
            "days_vacant": days_vacant,
            "last_rent": last_rent,
            "estimated_loss": estimated_loss,
            "last_tenant_name": last_tenant_name,
            "last_tenant_phone": last_tenant_phone,
            "last_tenant_email": last_tenant_email,
            "last_lease_end": last_lease_end,
            "ever_leased": lease is not None,
        })

    rows.sort(key=lambda r: -r["days_vacant"])

    # Summary
    total_vacant = sum(1 for r in rows if r["status"] == "vacant")
    total_inactive = sum(1 for r in rows if r["status"] == "inactive")
    never_leased = sum(1 for r in rows if not r["ever_leased"])
    day_vals = [r["days_vacant"] for r in rows]
    avg_days = round(sum(day_vals) / len(day_vals), 1) if day_vals else None
    total_loss = round(sum(r["estimated_loss"] for r in rows if r["estimated_loss"] is not None), 2)

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_vacant": total_vacant,
            "total_inactive": total_inactive,
            "never_leased": never_leased,
            "avg_days_vacant": avg_days,
            "total_estimated_loss": total_loss,
        },
        "rows": rows,
    }


# ── Vacancy Detail endpoints ──────────────────────────────────────────────────

@router.get("/vacancy-detail")
async def get_vacancy_detail(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await _build_vacancy_detail(property_id, current_user.org_id)


@router.get("/vacancy-detail/export")
async def export_vacancy_detail(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_vacancy_detail(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","
    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")
    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Vacancy Detail Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow([
        "Total Vacant:", s["total_vacant"],
        "Inactive:", s["total_inactive"],
        "Never Leased:", s["never_leased"],
        "Avg Days Vacant:", s["avg_days_vacant"] if s["avg_days_vacant"] is not None else "N/A",
        "Est. Rent Loss (KSh):", s["total_estimated_loss"],
    ])
    writer.writerow([])
    writer.writerow([
        "Unit Code", "Wing", "Floor", "Unit Type", "Size (m²)", "Status",
        "Days Vacant", "Last Rent (KSh)", "Est. Loss (KSh)",
        "Last Tenant", "Last Tenant Phone", "Last Tenant Email",
        "Last Lease End", "Ever Leased",
    ])
    for row in data["rows"]:
        writer.writerow([
            row["unit_code"], row["wing"], row["floor"], row["unit_type"],
            row["size"] or "",
            row["status"],
            row["days_vacant"],
            row["last_rent"] or "",
            row["estimated_loss"] if row["estimated_loss"] is not None else "",
            row["last_tenant_name"] or "",
            row["last_tenant_phone"] or "",
            row["last_tenant_email"] or "",
            row["last_lease_end"] or "",
            "Yes" if row["ever_leased"] else "No",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"vacancy_detail_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ── Utility Consumption data builder ─────────────────────────────────────────

async def _build_utility_consumption(property_id: str, org_id: str) -> dict:
    from app.models.invoice import Invoice

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property not found")

    # All non-void, non-draft invoices with at least one metered line item
    invoices = await Invoice.find(
        {
            "property_id": property_id,
            "org_id": org_id,
            "status": {"$nin": ["void", "draft"]},
            "sandbox": False,
            "deleted_at": None,
            "invoice_category": "rent",
        }
    ).to_list()

    # Fetch units once for display
    units = await Unit.find(
        {"property_id": prop.id, "org_id": org_id, "deleted_at": None}
    ).to_list()
    unit_map = {str(u.id): u for u in units}

    # ── Collect all metered readings ──────────────────────────────────────────
    # Structure: unit_id → utility_key → list of period readings
    from collections import defaultdict
    unit_utility: dict = defaultdict(lambda: defaultdict(list))
    period_utility: dict = defaultdict(lambda: defaultdict(lambda: {"consumption": 0.0, "amount": 0.0, "readings": 0}))
    global_utility: dict = defaultdict(lambda: {"consumption": 0.0, "amount": 0.0, "unit_ids": set(), "readings": 0})

    for inv in invoices:
        for li in inv.line_items:
            if li.type != "metered_utility":
                continue
            if li.status != "confirmed":
                continue
            ukey = li.utility_key or "unknown"
            consumption = li.quantity  # already = current - previous
            amount = li.amount

            unit_utility[inv.unit_id][ukey].append({
                "billing_month": inv.billing_month,
                "consumption": consumption,
                "current_reading": li.current_reading,
                "previous_reading": li.previous_reading,
                "unit_price": li.unit_price,
                "amount": amount,
                "is_tiered": bool(li.tiers),
                "tiers": [
                    {"from_units": t.from_units, "to_units": t.to_units, "rate": t.rate}
                    for t in li.tiers
                ] if li.tiers else None,
                "effective_rate": round(amount / consumption, 4) if consumption else li.unit_price,
            })
            p = period_utility[inv.billing_month][ukey]
            p["consumption"] += consumption
            p["amount"] += amount
            p["readings"] += 1

            g = global_utility[ukey]
            g["consumption"] += consumption
            g["amount"] += amount
            g["unit_ids"].add(inv.unit_id)
            g["readings"] += 1

    # ── Build per-unit rows ────────────────────────────────────────────────────
    rows = []
    for uid, utilities in unit_utility.items():
        unit = unit_map.get(uid)
        unit_code = unit.unit_code if unit else uid
        wing = (unit.wing or "—") if unit else "—"
        floor = unit.floor if unit else 0
        unit_type = unit.unit_type if unit else "unknown"

        for ukey, periods in utilities.items():
            total_consumption = sum(p["consumption"] for p in periods)
            total_amount = sum(p["amount"] for p in periods)
            num_periods = len(periods)
            avg_monthly = round(total_consumption / num_periods, 2) if num_periods else 0
            # Sort periods chronologically for last-reading lookup
            sorted_periods = sorted(periods, key=lambda p: p["billing_month"])
            last_reading = sorted_periods[-1]["current_reading"] if sorted_periods else None
            first_month = sorted_periods[0]["billing_month"] if sorted_periods else None
            last_month = sorted_periods[-1]["billing_month"] if sorted_periods else None

            rows.append({
                "unit_id": uid,
                "unit_code": unit_code,
                "wing": wing,
                "floor": floor,
                "unit_type": unit_type,
                "utility_key": ukey,
                "total_consumption": round(total_consumption, 4),
                "total_amount": round(total_amount, 2),
                "num_periods": num_periods,
                "avg_monthly_consumption": avg_monthly,
                "last_reading": last_reading,
                "first_month": first_month,
                "last_month": last_month,
                "is_tiered": any(p.get("is_tiered") for p in sorted_periods),
                "effective_rate": round(total_amount / total_consumption, 4) if total_consumption else 0.0,
                "periods": sorted_periods,
            })

    rows.sort(key=lambda r: (r["utility_key"], r["unit_code"]))

    # ── By period ─────────────────────────────────────────────────────────────
    by_period = []
    for month in sorted(period_utility.keys()):
        entry: dict = {"billing_month": month, "utilities": {}}
        for ukey, stats in period_utility[month].items():
            entry["utilities"][ukey] = {
                "consumption": round(stats["consumption"], 4),
                "amount": round(stats["amount"], 2),
                "readings": stats["readings"],
            }
        by_period.append(entry)

    # ── By utility (global) ───────────────────────────────────────────────────
    by_utility = []
    for ukey, stats in global_utility.items():
        by_utility.append({
            "utility_key": ukey,
            "total_consumption": round(stats["consumption"], 4),
            "total_amount": round(stats["amount"], 2),
            "unit_count": len(stats["unit_ids"]),
            "readings": stats["readings"],
        })
    by_utility.sort(key=lambda x: -x["total_consumption"])

    # ── Summary ───────────────────────────────────────────────────────────────
    utility_keys = sorted(global_utility.keys())
    summary_by_utility = {
        ukey: {
            "total_consumption": round(global_utility[ukey]["consumption"], 4),
            "total_amount": round(global_utility[ukey]["amount"], 2),
            "unit_count": len(global_utility[ukey]["unit_ids"]),
        }
        for ukey in utility_keys
    }

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "utility_keys": utility_keys,
        "summary": {
            "total_readings": sum(g["readings"] for g in global_utility.values()),
            "metered_unit_count": len({r["unit_id"] for r in rows}),
            "period_count": len(by_period),
            "by_utility": summary_by_utility,
        },
        "by_period": by_period,
        "by_utility": by_utility,
        "rows": rows,
    }


# ── Utility Consumption endpoints ─────────────────────────────────────────────

@router.get("/utility-consumption")
async def get_utility_consumption(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await _build_utility_consumption(property_id, current_user.org_id)


@router.get("/utility-consumption/export")
async def export_utility_consumption(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_utility_consumption(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","
    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")
    writer = csv.writer(output, delimiter=delimiter)

    writer.writerow(["Utility Consumption Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow([])

    # Global summary by utility
    writer.writerow(["SUMMARY BY UTILITY"])
    writer.writerow(["Utility", "Total Consumption", "Total Billed (KSh)", "Units"])
    for bu in data["by_utility"]:
        writer.writerow([bu["utility_key"], bu["total_consumption"], bu["total_amount"], bu["unit_count"]])
    writer.writerow([])

    # By period matrix: rows = months, cols = utility types
    writer.writerow(["CONSUMPTION BY PERIOD"])
    ukeys = data["utility_keys"]
    header = ["Billing Month"] + [f"{k} (units)" for k in ukeys] + [f"{k} (KSh)" for k in ukeys]
    writer.writerow(header)
    for period in data["by_period"]:
        row_data = [period["billing_month"]]
        for k in ukeys:
            u = period["utilities"].get(k, {})
            row_data.append(u.get("consumption", ""))
        for k in ukeys:
            u = period["utilities"].get(k, {})
            row_data.append(u.get("amount", ""))
        writer.writerow(row_data)
    writer.writerow([])

    # Per-unit detail
    writer.writerow(["PER UNIT DETAIL"])
    writer.writerow([
        "Unit Code", "Wing", "Floor", "Unit Type", "Utility",
        "Periods", "Total Consumption", "Avg Monthly", "Last Reading",
        "Pricing", "Effective Rate", "Total Billed (KSh)", "First Month", "Last Month",
    ])
    for row in data["rows"]:
        # Summarise pricing from the last period that has tier data
        last_tiered = next(
            (p for p in reversed(row["periods"]) if p.get("is_tiered") and p.get("tiers")), None
        )
        if last_tiered:
            pricing = "Tiered: " + " | ".join(
                f"{t['from_units']}-{t['to_units'] or '∞'} @ {t['rate']}"
                for t in last_tiered["tiers"]
            )
        else:
            last_p = row["periods"][-1] if row["periods"] else {}
            pricing = f"Flat @ {last_p.get('unit_price', '')}"
        writer.writerow([
            row["unit_code"], row["wing"], row["floor"], row["unit_type"],
            row["utility_key"], row["num_periods"],
            row["total_consumption"], row["avg_monthly_consumption"],
            row["last_reading"] if row["last_reading"] is not None else "",
            pricing, row["effective_rate"],
            row["total_amount"], row["first_month"] or "", row["last_month"] or "",
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"utility_consumption_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ── Meter Readings data builder ───────────────────────────────────────────────

async def _build_meter_readings(property_id: str, org_id: str) -> dict:
    from app.models.invoice import Invoice

    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property not found")

    units = await Unit.find(
        {"property_id": prop.id, "org_id": org_id, "deleted_at": None}
    ).to_list()
    unit_map = {str(u.id): u for u in units}

    # Non-void invoices with metered line items
    invoices = await Invoice.find(
        {
            "property_id": property_id,
            "org_id": org_id,
            "status": {"$nin": ["void", "draft"]},
            "sandbox": False,
            "deleted_at": None,
            "invoice_category": "rent",
        }
    ).to_list()

    rows = []
    for inv in invoices:
        for li in inv.line_items:
            if li.type != "metered_utility":
                continue
            unit = unit_map.get(inv.unit_id)
            unit_code = unit.unit_code if unit else inv.unit_id
            wing = (unit.wing or "—") if unit else "—"
            floor = unit.floor if unit else 0
            unit_type = unit.unit_type if unit else "unknown"
            meter_number = (unit.meter_number or f"MTR-{unit_code}") if unit else "—"

            rows.append({
                "invoice_id": str(inv.id),
                "invoice_reference": inv.reference_no,
                "line_item_id": li.id,
                "unit_id": inv.unit_id,
                "unit_code": unit_code,
                "wing": wing,
                "floor": floor,
                "unit_type": unit_type,
                "meter_number": meter_number,
                "utility_key": li.utility_key or "unknown",
                "billing_month": inv.billing_month,
                "previous_reading": li.previous_reading,
                "current_reading": li.current_reading,
                "consumption": li.quantity,
                "unit_price": li.unit_price,
                "amount": li.amount,
                "is_tiered": bool(li.tiers),
                "tiers": [
                    {"from_units": t.from_units, "to_units": t.to_units, "rate": t.rate}
                    for t in li.tiers
                ] if li.tiers else None,
                "effective_rate": round(li.amount / li.quantity, 4) if li.quantity else li.unit_price,
                "status": li.status,  # confirmed | pending
                "has_photo": li.meter_image_key is not None,
                "meter_ticket_id": li.meter_ticket_id,
            })

    # Sort: unit_code → billing_month desc → utility_key
    rows.sort(key=lambda r: (r["unit_code"], r["billing_month"], r["utility_key"]))

    # Live cache: units with meter_reading_cache but no invoice reading this month
    live_entries = []
    current_month = date.today().strftime("%Y-%m")
    invoiced_pairs = {(r["unit_id"], r["utility_key"], r["billing_month"]) for r in rows}
    for unit in units:
        if not unit.meter_reading_cache:
            continue
        for ukey, entry in unit.meter_reading_cache.items():
            if (str(unit.id), ukey, current_month) not in invoiced_pairs:
                live_entries.append({
                    "unit_id": str(unit.id),
                    "unit_code": unit.unit_code,
                    "wing": unit.wing or "—",
                    "floor": unit.floor,
                    "unit_type": unit.unit_type,
                    "meter_number": unit.meter_number or f"MTR-{unit.unit_code}",
                    "utility_key": ukey,
                    "current_reading": entry.value,
                    "read_at": entry.read_at.date().isoformat(),
                    "read_by_name": entry.read_by_name,
                })

    # Summary
    confirmed = sum(1 for r in rows if r["status"] == "confirmed")
    pending = sum(1 for r in rows if r["status"] == "pending")
    pending_units = len({r["unit_id"] for r in rows if r["status"] == "pending"})

    from collections import defaultdict
    by_utility: dict = defaultdict(lambda: {"confirmed": 0, "pending": 0, "total_consumption": 0.0})
    for r in rows:
        k = r["utility_key"]
        by_utility[k][r["status"]] = by_utility[k].get(r["status"], 0) + 1
        if r["status"] == "confirmed":
            by_utility[k]["total_consumption"] += r["consumption"]

    billing_months = sorted({r["billing_month"] for r in rows}, reverse=True)

    return {
        "property_id": property_id,
        "property_name": prop.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": {
            "total_readings": len(rows),
            "confirmed": confirmed,
            "pending": pending,
            "pending_units": pending_units,
            "by_utility": {k: dict(v) for k, v in by_utility.items()},
        },
        "billing_months": billing_months,
        "rows": rows,
        "live_cache": live_entries,
    }


# ── Meter Readings endpoints ──────────────────────────────────────────────────

@router.get("/meter-readings")
async def get_meter_readings(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await _build_meter_readings(property_id, current_user.org_id)


@router.get("/meter-readings/export")
async def export_meter_readings(
    property_id: str,
    format: str = Query(default="csv", description="Export format: csv | tsv"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    data = await _build_meter_readings(property_id, current_user.org_id)
    prop_name = data["property_name"].replace(" ", "_")
    today = date.today().isoformat()

    fmt = format.lower()
    delimiter = "\t" if fmt == "tsv" else ","
    output = io.StringIO()
    if fmt == "csv":
        output.write("\ufeff")
    writer = csv.writer(output, delimiter=delimiter)

    s = data["summary"]
    writer.writerow(["Meter Readings Report"])
    writer.writerow(["Property:", data["property_name"]])
    writer.writerow(["Generated:", data["generated_at"][:10]])
    writer.writerow([
        "Total:", s["total_readings"],
        "Confirmed:", s["confirmed"],
        "Pending:", s["pending"],
        "Units with Pending:", s["pending_units"],
    ])
    writer.writerow([])

    writer.writerow([
        "Unit Code", "Meter No.", "Wing", "Floor", "Type", "Utility",
        "Billing Month", "Previous Reading", "Current Reading",
        "Consumption", "Pricing", "Effective Rate", "Amount (KSh)", "Status", "Has Photo",
        "Invoice Ref",
    ])
    for row in data["rows"]:
        if row["is_tiered"] and row["tiers"]:
            pricing = "Tiered: " + " | ".join(
                f"{t['from_units']}-{t['to_units'] or '∞'} @ {t['rate']}"
                for t in row["tiers"]
            )
        else:
            pricing = f"Flat @ {row['unit_price']}"
        writer.writerow([
            row["unit_code"], row["meter_number"], row["wing"], row["floor"],
            row["unit_type"], row["utility_key"], row["billing_month"],
            row["previous_reading"] if row["previous_reading"] is not None else "",
            row["current_reading"] if row["current_reading"] is not None else "",
            row["consumption"],
            pricing,
            row["effective_rate"],
            row["amount"],
            row["status"],
            "Yes" if row["has_photo"] else "No",
            row["invoice_reference"],
        ])

    content = output.getvalue()
    ext = "tsv" if fmt == "tsv" else "csv"
    filename = f"meter_readings_{prop_name}_{today}.{ext}"
    media_type = "text/tab-separated-values" if fmt == "tsv" else "text/csv"

    return StreamingResponse(
        iter([content.encode("utf-8-sig" if fmt == "csv" else "utf-8")]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Vacancy Loss ───────────────────────────────────────────────────────────────

@router.get("/vacancy-loss")
async def vacancy_loss_report(
    property_id: str,
    months: int = Query(default=6, ge=1, le=24),
    current_user: CurrentUser = Depends(get_current_user),
    _=Depends(require_roles("owner", "agent", "superadmin")),
):
    """Calculate revenue lost due to vacant units per month."""
    org_id = current_user.org_id
    prop = await property_repository.get_by_id(property_id, org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    units = await Unit.find(
        {"property_id": prop.id, "org_id": org_id, "deleted_at": None}
    ).to_list()
    today = date.today()
    results = []
    for i in range(months - 1, -1, -1):
        first = date(today.year, today.month, 1) - timedelta(days=i * 30)
        first = first.replace(day=1)
        label = first.strftime("%b %Y")
        key = first.strftime("%Y-%m")
        active_leases = await Lease.find(
            Lease.property_id == property_id,
            Lease.org_id == org_id,
            Lease.status == "active",
            Lease.start_date <= date(first.year, first.month, 28),
            Lease.deleted_at == None,  # noqa: E711
        ).to_list()
        occupied_unit_ids = {le.unit_id for le in active_leases}
        vacant_units = [u for u in units if str(u.id) not in occupied_unit_ids]
        avg_rent = (
            sum(le.rent_amount for le in active_leases) / len(active_leases)
            if active_leases
            else 0
        )
        vacancy_loss = round(len(vacant_units) * avg_rent, 2)
        results.append({
            "month": key,
            "label": label,
            "total_units": len(units),
            "occupied": len(occupied_unit_ids),
            "vacant": len(vacant_units),
            "occupancy_pct": round(len(occupied_unit_ids) / len(units) * 100, 1) if units else 0,
            "vacancy_loss": vacancy_loss,
        })
    return {
        "property_id": property_id,
        "months": results,
        "total_loss": round(sum(r["vacancy_loss"] for r in results), 2),
    }


# ── Expiry Calendar ────────────────────────────────────────────────────────────

@router.get("/expiry-calendar")
async def expiry_calendar(
    property_id: str,
    days_ahead: int = Query(default=90, ge=1, le=365),
    current_user: CurrentUser = Depends(get_current_user),
    _=Depends(require_roles("owner", "agent", "superadmin")),
):
    """List upcoming lease expirations within the given window."""
    org_id = current_user.org_id
    cutoff = date.today() + timedelta(days=days_ahead)
    leases = await Lease.find(
        Lease.property_id == property_id,
        Lease.org_id == org_id,
        Lease.status == "active",
        Lease.end_date != None,  # noqa: E711
        Lease.end_date <= cutoff,
        Lease.deleted_at == None,  # noqa: E711
    ).sort("+end_date").to_list()
    today = date.today()
    items = []
    for le in leases:
        days_left = (le.end_date - today).days if le.end_date else None
        renewal_status = None
        if le.renewal_offer:
            renewal_status = le.renewal_offer.status
        items.append({
            "lease_id": str(le.id),
            "tenant_id": le.tenant_id,
            "unit_id": le.unit_id,
            "end_date": le.end_date.isoformat() if le.end_date else None,
            "days_until_expiry": days_left,
            "rent_amount": le.rent_amount,
            "renewal_offer_status": renewal_status,
            "urgency": (
                "critical" if days_left is not None and days_left <= 14
                else "warning" if days_left is not None and days_left <= 30
                else "notice"
            ),
        })
    return {
        "property_id": property_id,
        "days_ahead": days_ahead,
        "total": len(items),
        "items": items,
    }


# ── Payment Scorecard ──────────────────────────────────────────────────────────

@router.get("/payment-scorecard")
async def payment_scorecard(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _=Depends(require_roles("owner", "agent", "superadmin")),
):
    """Tenant payment timeliness scorecard for the property."""
    from app.models.invoice import Invoice
    org_id = current_user.org_id
    leases = await Lease.find(
        Lease.property_id == property_id,
        Lease.org_id == org_id,
        {"status": {"$in": ["active", "terminated", "expired"]}},
        Lease.deleted_at == None,  # noqa: E711
    ).to_list()
    scorecards = []
    for lease in leases:
        invoices = await Invoice.find(
            Invoice.lease_id == str(lease.id),
            Invoice.org_id == org_id,
            Invoice.sandbox == False,  # noqa: E712
            Invoice.deleted_at == None,  # noqa: E711
            Invoice.invoice_category == "rent",
        ).to_list()
        from datetime import timedelta as _td
        GRACE = 7
        total_invoices = len(invoices)
        paid_with_date = [
            inv for inv in invoices
            if inv.status == "paid"
            and getattr(inv, "paid_at", None)
            and getattr(inv, "due_date", None)
        ]
        paid_on_time = sum(
            1 for inv in paid_with_date
            if inv.paid_at.date() <= inv.due_date + _td(days=GRACE)
        )
        paid_late = sum(
            1 for inv in paid_with_date
            if inv.paid_at.date() > inv.due_date + _td(days=GRACE)
        )
        outstanding = sum(
            1 for inv in invoices
            if inv.status in ("overdue", "partial_paid", "sent", "ready")
        )
        # on_time_rate: % of fully-paid invoices settled within grace period
        score = round((paid_on_time / len(paid_with_date) * 100), 1) if paid_with_date else None
        scorecards.append({
            "lease_id": str(lease.id),
            "tenant_id": lease.tenant_id,
            "unit_id": lease.unit_id,
            "total_invoices": total_invoices,
            "paid_on_time": paid_on_time,
            "paid_late": paid_late,
            "outstanding": outstanding,
            "on_time_rate": score,
            "rating": lease.rating.model_dump() if lease.rating else None,
        })
    scorecards.sort(key=lambda x: (x["on_time_rate"] or 0), reverse=True)
    return {"property_id": property_id, "tenants": scorecards}


# ── Discount Impact ────────────────────────────────────────────────────────────

@router.get("/discount-impact")
async def discount_impact_report(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _=Depends(require_roles("owner", "agent", "superadmin")),
):
    """Total discount given vs rent collected for property."""
    org_id = current_user.org_id
    today = date.today()
    leases = await Lease.find(
        Lease.property_id == property_id,
        Lease.org_id == org_id,
        Lease.deleted_at == None,  # noqa: E711
    ).to_list()
    total_active_discounts = 0
    total_monthly_saving = 0.0
    total_historical_saving = 0.0
    discount_breakdown = []
    for lease in leases:
        for d in (lease.discounts or []):
            active = d.effective_from <= today and (
                d.effective_to is None or d.effective_to >= today
            )
            disc_amount = (
                d.value
                if d.type == "fixed"
                else round(lease.rent_amount * d.value / 100, 2)
            )
            if d.effective_to:
                months_active = max(
                    0,
                    (d.effective_to.year - d.effective_from.year) * 12
                    + (d.effective_to.month - d.effective_from.month),
                )
            else:
                months_active = max(
                    0,
                    (today.year - d.effective_from.year) * 12
                    + (today.month - d.effective_from.month),
                )
            historical = round(disc_amount * months_active, 2)
            if active:
                total_active_discounts += 1
                total_monthly_saving += disc_amount
            total_historical_saving += historical
            discount_breakdown.append({
                "lease_id": str(lease.id),
                "unit_id": lease.unit_id,
                "label": d.label,
                "type": d.type,
                "value": d.value,
                "monthly_saving": disc_amount,
                "active": active,
                "effective_from": d.effective_from.isoformat(),
                "effective_to": d.effective_to.isoformat() if d.effective_to else None,
                "months_applied": months_active,
                "total_given": historical,
            })
    return {
        "property_id": property_id,
        "active_discounts": total_active_discounts,
        "monthly_saving": round(total_monthly_saving, 2),
        "historical_total_saving": round(total_historical_saving, 2),
        "breakdown": discount_breakdown,
    }
