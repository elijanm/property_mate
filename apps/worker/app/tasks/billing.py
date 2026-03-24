"""Billing run worker task — handles BillingRunPayload from billing.runs queue.

Uses raw Motor queries (no Beanie) consistent with the worker's pattern.
The API endpoint /invoices/generate enqueues non-dry-run billing here; this
task performs the actual invoice generation asynchronously and publishes a
WebSocket notification to the org on completion or failure.
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId as BsonObjectId

import aio_pika

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.metrics import task_metrics_wrap
from app.core.redis import get_redis
from app.utils.datetime import utc_now

logger = get_logger(__name__)

QUEUE_NAME = "billing.runs"


def _to_oid(id_str) -> Optional[BsonObjectId]:
    """Safely convert a string to BsonObjectId; returns None if invalid."""
    try:
        return BsonObjectId(str(id_str)) if id_str else None
    except Exception:
        return None


async def _publish_ws_notification(
    org_id: str,
    event_type: str,
    title: str,
    message: str,
    data: dict,
) -> None:
    """Publish a notification to the org's WebSocket pub/sub channel."""
    try:
        payload = json.dumps({
            "id": str(uuid.uuid4()),
            "type": event_type,
            "title": title,
            "message": message,
            "data": data,
            "org_id": org_id,
            "timestamp": utc_now().isoformat(),
        })
        redis = get_redis()
        await redis.publish(f"ws:notifications:{org_id}", payload)
    except Exception as exc:
        logger.warning(
            "ws_notify_failed",
            action="publish_ws_notification",
            org_id=org_id,
            event_type=event_type,
            status="error",
            exc_info=exc,
        )


def _billing_month_start(billing_month: str) -> date:
    year, month = map(int, billing_month.split("-"))
    return date(year, month, 1)


_STD_UTILITY_KEYS = ["electricity", "water", "gas", "internet", "garbage", "security"]


def _get_attr(obj, key):
    """Get a value from either a dict or an object (Pydantic model / dataclass)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _to_dict(obj) -> dict:
    """Convert a value to a plain dict if it is a Pydantic model; leave dicts unchanged."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    # Pydantic v1 / v2 model
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    return {}


def _effective_utility(key: str, property_, unit) -> dict:
    """Return unit-level override if set, else property default.

    Handles both raw Motor dicts and Beanie/Pydantic model objects transparently.
    """
    # Unit-level overrides
    raw_overrides = _get_attr(unit, "utility_overrides")
    override = _get_attr(raw_overrides, key)
    if override is not None:
        detail = _to_dict(override) if not isinstance(override, dict) else override
        if detail and detail.get("type"):
            return detail

    # Fall back to property utility_defaults
    defaults = _get_attr(property_, "utility_defaults")
    prop_val = _get_attr(defaults, key)
    if prop_val is not None:
        detail = _to_dict(prop_val) if not isinstance(prop_val, dict) else prop_val
        if detail and detail.get("type"):
            return detail

    return {}


def _compute_line_items(lease: dict, property_: dict, unit: dict) -> List[dict]:
    items = []
    items.append({
        "id": str(uuid.uuid4()),
        "type": "rent",
        "description": "Monthly Rent",
        "quantity": 1.0,
        "unit_price": lease.get("rent_amount", 0),
        "amount": lease.get("rent_amount", 0),
        "status": "confirmed",
    })

    for key in _STD_UTILITY_KEYS:
        detail = _effective_utility(key, property_, unit)
        if not detail:
            continue
        if detail.get("type") in ("subscription", "shared"):
            rate = detail.get("rate") or 0.0
            items.append({
                "id": str(uuid.uuid4()),
                "type": "subscription_utility",
                "description": detail.get("label") or key.capitalize(),
                "utility_key": key,
                "quantity": 1.0,
                "unit_price": rate,
                "amount": rate,
                "status": "confirmed",
            })
        elif detail.get("type") == "metered":
            # Tiers may be a list of PricingTier objects or raw dicts — normalise to dicts
            raw_tiers = detail.get("tiers")
            tiers = None
            if raw_tiers:
                tiers = [_to_dict(t) if not isinstance(t, dict) else t for t in raw_tiers] or None
            items.append({
                "id": str(uuid.uuid4()),
                "type": "metered_utility",
                "description": f"{detail.get('label') or key.capitalize()} (Metered)",
                "utility_key": key,
                "quantity": 0.0,
                "unit_price": detail.get("rate") or 0.0,
                "amount": 0.0,
                "tiers": tiers,
                "status": "pending",
            })
    return items


import secrets as _secrets


async def _create_property_meter_tickets(
    db,
    org_id: str,
    billing_month: str,
    property_tasks: dict,
    created_invoices: Dict[str, dict],
) -> List[str]:
    """Create one meter reading ticket per property. Returns list of ticket ids."""
    ticket_ids = []
    now = utc_now()

    for property_id, task_infos in property_tasks.items():
        tasks = []
        for info in task_infos:
            tenant_display = info.get("tenant_name") or ""
            unit_display = info.get("unit_code") or info.get("unit_id", "")
            title = f"{info.get('utility_label', info.get('utility_key', 'Meter'))} — {unit_display}"
            if tenant_display:
                title += f" ({tenant_display})"
            tasks.append({
                "id": str(uuid.uuid4()),
                "title": title,
                "task_type": "meter_reading",
                "status": "pending",
                "meter_number": info.get("meter_number"),
                "previous_reading": info.get("previous_reading"),
                "current_reading": None,
                "unit_of_measure": "units",
                "unit_id": info.get("unit_id"),
                "unit_code": info.get("unit_code"),
                "tenant_name": info.get("tenant_name"),
                "invoice_id": info.get("invoice_id"),
                "line_item_id": info.get("line_item_id"),
                "utility_key": info.get("utility_key"),
                "notes": None,
                "attachment_keys": [],
                "assigned_to": None,
                "completed_at": None,
                "created_at": now,
                "updated_at": now,
            })

        token = _secrets.token_urlsafe(32)
        ticket_oid = BsonObjectId()
        ticket_id = str(ticket_oid)
        ticket = {
            "_id": ticket_oid,
            "org_id": org_id,
            "property_id": property_id,
            "unit_id": None,
            "tenant_id": None,
            "assigned_to": None,
            "category": "utility_reading",
            "priority": "normal",
            "status": "open",
            "title": f"Meter Readings — {billing_month}",
            "description": f"Submit meter readings for all metered units for billing month {billing_month}.",
            "attachment_keys": [],
            "comments": [],
            "activity": [{
                "id": str(uuid.uuid4()),
                "type": "system",
                "actor_id": None,
                "actor_role": None,
                "actor_name": None,
                "description": f"Meter reading ticket created by billing run ({billing_month})",
                "created_at": now,
            }],
            "tasks": tasks,
            "submission_token": token,
            "submission_data": None,
            "submitted_at": None,
            "resolution_notes": None,
            "resolved_at": None,
            "closed_at": None,
            "created_by": "system",
            "deleted_at": None,
            "created_at": now,
            "updated_at": now,
        }
        await db["tickets"].insert_one(ticket)
        ticket_ids.append(ticket_id)

        # Stamp each invoice's line items with this ticket_id
        invoice_to_line_items: dict = {}
        for info in task_infos:
            inv_id = info["invoice_id"]
            if inv_id not in invoice_to_line_items:
                invoice_to_line_items[inv_id] = []
            invoice_to_line_items[inv_id].append(info["line_item_id"])

        for inv_id, line_item_ids in invoice_to_line_items.items():
            inv = created_invoices.get(inv_id)
            if not inv:
                continue
            updated_items = []
            for li in inv.get("line_items", []):
                if li.get("id") in line_item_ids:
                    li = dict(li)
                    li["meter_ticket_id"] = ticket_id
                updated_items.append(li)
            await db["invoices"].update_one(
                {"_id": _to_oid(inv_id)},
                {"$set": {"line_items": updated_items, "updated_at": now}},
            )

    return ticket_ids


async def _run_billing(
    db,
    org_id: str,
    billing_month: str,
    sandbox: bool,
    dry_run: bool,
    triggered_by: str,
    cycle_run_id: str,
) -> Dict[str, Any]:
    """Core billing logic using raw Motor queries."""
    created = 0
    skipped = 0
    failed = 0
    failures = []

    # Fetch org for settings
    org = await db["orgs"].find_one({"org_id": org_id, "deleted_at": None})
    if not org:
        raise ValueError(f"Org {org_id} not found")

    prefix = (org.get("ledger_settings") or {}).get("invoice_prefix", "INV")
    grace_days = (org.get("billing_config") or {}).get("payment_grace_days", 7)
    month_start = _billing_month_start(billing_month)
    due_date = month_start + timedelta(days=grace_days)

    vat_enabled = (org.get("tax_config") or {}).get("vat_enabled", False)
    vat_rate = (org.get("tax_config") or {}).get("vat_rate", 16.0)
    vat_inclusive = (org.get("tax_config") or {}).get("vat_inclusive", False)

    # Fetch active leases
    leases = await db["leases"].find(
        {"org_id": org_id, "status": "active", "deleted_at": None}
    ).to_list(length=None)

    # property_id -> list of task info dicts (for meter reading tickets)
    property_metered_tasks: Dict[str, List[dict]] = {}
    # invoice_id -> created invoice doc (to stamp line items with ticket_id)
    created_invoices: Dict[str, dict] = {}

    for lease in leases:
    
        lease_id = lease.get("id") or str(lease.get("_id"))
        sandbox_prefix = "sandbox:" if sandbox else ""
        idempotency_key = f"{sandbox_prefix}{lease_id}:{billing_month}"

        try:
            existing = await db["invoices"].find_one(
                {"idempotency_key": idempotency_key, "deleted_at": None}
            )
            if existing:
                skipped += 1
                continue

            # Fetch property + unit
            property_ = await db["properties"].find_one(
                {"_id": _to_oid(lease.get("property_id")), "org_id": org_id, "deleted_at": None}
            )
            if not property_:
                failed += 1
                failures.append({"lease_id": lease_id, "error": "Property not found"})
                continue

            unit = None
            if lease.get("unit_id"):
                unit = await db["units"].find_one(
                    {"_id": _to_oid(lease["unit_id"]), "org_id": org_id, "deleted_at": None}
                )
                if unit is None:
                    logger.warning(
                        "billing_unit_not_found",
                        action="generate_invoice",
                        org_id=org_id,
                        lease_id=lease_id,
                        unit_id=lease.get("unit_id"),
                        status="warn",
                    )
                else:
                    overrides = (unit.get("utility_overrides") or {})
                    logger.info(
                        "billing_unit_resolved",
                        action="generate_invoice",
                        org_id=org_id,
                        lease_id=lease_id,
                        unit_id=str(unit.get("_id")),
                        has_utility_overrides=bool(overrides),
                        override_keys=[k for k, v in overrides.items() if v and isinstance(v, dict) and v.get("type")],
                        status="started",
                    )

            # Carried forward balance
            last_entry = await db["ledger_entries"].find_one(
                {"org_id": org_id, "lease_id": lease_id},
                sort=[("created_at", -1)],
            )
            carried_forward = 0.0
            if last_entry:
                balance = last_entry.get("running_balance", 0)
                if balance < 0:
                    carried_forward = abs(balance)

            line_items = _compute_line_items(lease, property_, unit or {})
            # Debug: log metered items and whether tiers were captured
            for _li in line_items:
                if _li.get("type") == "metered_utility":
                    logger.info(
                        "billing_metered_line_item",
                        action="generate_invoice",
                        org_id=org_id,
                        lease_id=lease_id,
                        utility_key=_li.get("utility_key"),
                        unit_price=_li.get("unit_price"),
                        tiers_count=len(_li.get("tiers") or []),
                        has_tiers=bool(_li.get("tiers")),
                        status="started",
                    )
            if carried_forward > 0:
                line_items.append({
                    "id": str(uuid.uuid4()),
                    "type": "carried_forward",
                    "description": "Outstanding Balance Carried Forward",
                    "quantity": 1.0,
                    "unit_price": carried_forward,
                    "amount": carried_forward,
                    "status": "confirmed",
                })

            # Compute totals
            subtotal = sum(li["amount"] for li in line_items if li["status"] == "confirmed")
            tax_amount = 0.0
            if vat_enabled and not vat_inclusive:
                tax_amount = subtotal * (vat_rate / 100.0)
            total = subtotal + tax_amount

            if dry_run:
                created += 1
                continue

            # Generate reference number atomically
            result = await db["orgs"].find_one_and_update(
                {"org_id": org_id},
                {"$inc": {"invoice_counter": 1}},
                return_document=True,
                projection={"invoice_counter": 1},
            )
            counter = result.get("invoice_counter", 1) if result else 1
            reference_no = f"{prefix}-{counter:06d}"

            now = utc_now()
            invoice_oid = BsonObjectId()
            invoice_id = str(invoice_oid)
            invoice = {
                "_id": invoice_oid,
                "org_id": org_id,
                "property_id": lease.get("property_id"),
                "unit_id": lease.get("unit_id"),
                "lease_id": lease_id,
                "tenant_id": lease.get("tenant_id"),
                "idempotency_key": idempotency_key,
                "billing_month": billing_month,
                "status": "draft",
                "sandbox": sandbox,
                "reference_no": reference_no,
                "due_date": due_date.isoformat(),
                "line_items": line_items,
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "total_amount": total,
                "amount_paid": 0.0,
                "balance_due": total,
                "carried_forward": carried_forward,
                "created_by": triggered_by,
                "deleted_at": None,
                "created_at": now,
                "updated_at": now,
            }
            await db["invoices"].insert_one(invoice)
            created_invoices[invoice_id] = invoice
            created += 1

            # Collect metered line items for property-level ticket
            tenant = None
            if lease.get("tenant_id"):
                tenant = await db["users"].find_one({"_id": _to_oid(lease["tenant_id"])})
            tenant_first = (tenant or {}).get("first_name", "")
            unit_code = (unit or {}).get("unit_code") or lease.get("unit_id", "")

            for li in line_items:
                if li.get("type") == "metered_utility" and li.get("status") == "pending" and li.get("utility_key"):
                    # Fetch previous reading
                    prev_reading = None
                    mr_cache = (unit or {}).get("meter_reading_cache") or {}
                    cached = mr_cache.get(li["utility_key"])
                    if cached:
                        prev_reading = cached.get("value")
                    else:
                        prev_mr = await db["meter_readings"].find_one(
                            {"org_id": org_id, "unit_id": lease.get("unit_id"), "utility_key": li["utility_key"]},
                            sort=[("read_at", -1)],
                        )
                        if prev_mr:
                            prev_reading = prev_mr.get("current_reading")

                    prop_id = lease.get("property_id")
                    if prop_id not in property_metered_tasks:
                        property_metered_tasks[prop_id] = []
                    property_metered_tasks[prop_id].append({
                        "invoice_id": invoice_id,
                        "line_item_id": li["id"],
                        "unit_id": lease.get("unit_id"),
                        "unit_code": unit_code,
                        "tenant_name": tenant_first,
                        "utility_key": li["utility_key"],
                        "utility_label": li["description"].replace(" (Metered)", ""),
                        "previous_reading": prev_reading,
                        "meter_number": None,
                    })

        except Exception as exc:
            failed += 1
            failures.append({"lease_id": lease_id, "error": str(exc)})
            logger.error(
                "billing_invoice_failed",
                action="generate_invoice",
                resource_type="invoice",
                org_id=org_id,
                lease_id=lease_id,
                status="error",
                error_code="INVOICE_GENERATION_ERROR",
            )

    # Create one meter reading ticket per property
    meter_ticket_ids: List[str] = []
    if not dry_run and property_metered_tasks:
        try:
            meter_ticket_ids = await _create_property_meter_tickets(
                db=db,
                org_id=org_id,
                billing_month=billing_month,
                property_tasks=property_metered_tasks,
                created_invoices=created_invoices,
            )
        except Exception as exc:
            logger.warning(
                "meter_tickets_failed",
                action="create_property_meter_tickets",
                org_id=org_id,
                billing_month=billing_month,
                status="error",
                exc_info=exc,
            )

    return {
        "invoices_created": created,
        "invoices_skipped": skipped,
        "invoices_failed": failed,
        "failures": failures,
        "meter_ticket_ids": meter_ticket_ids,
    }


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload: dict = {}
        try:
            payload = json.loads(message.body)
            org_id = payload.get("org_id")
            billing_month = payload.get("billing_month") or payload.get("billing_period")
            sandbox = payload.get("sandbox", False)
            dry_run = payload.get("dry_run", False)
            job_id = payload.get("job_id") or payload.get("event_id") or message.correlation_id
            triggered_by = payload.get("user_id") or "scheduler"

            logger.info(
                "action",
                action="billing_run_started",
                resource_type="billing_run",
                resource_id=job_id,
                org_id=org_id,
                billing_month=billing_month,
                status="started",
            )

            db = get_db()

            if job_id:
                await db["job_runs"].update_one(
                    {"_id": _to_oid(job_id)},
                    {"$set": {"status": "in_progress", "updated_at": utc_now()}},
                )

            # Create a BillingCycleRun record
            now = utc_now()
            cycle_run_oid = BsonObjectId()
            cycle_run_id = str(cycle_run_oid)
            run_type = "dry_run" if dry_run else ("sandbox" if sandbox else "auto")
            await db["billing_cycle_runs"].insert_one({
                "_id": cycle_run_oid,
                "org_id": org_id,
                "billing_month": billing_month,
                "run_type": run_type,
                "sandbox": sandbox,
                "triggered_by": triggered_by,
                "status": "running",
                "invoices_created": 0,
                "invoices_skipped": 0,
                "invoices_failed": 0,
                "failures": [],
                "started_at": now,
                "completed_at": None,
                "deleted_at": None,
                "created_at": now,
                "updated_at": now,
            })

            result = await _run_billing(
                db=db,
                org_id=org_id,
                billing_month=billing_month,
                sandbox=sandbox,
                dry_run=dry_run,
                triggered_by=triggered_by,
                cycle_run_id=cycle_run_id,
            )

            final_status = "completed"
            if result["invoices_failed"] > 0 and result["invoices_created"] == 0:
                final_status = "partial" if result["invoices_skipped"] > 0 else "failed"
            elif result["invoices_failed"] > 0:
                final_status = "partial"

            meter_ticket_ids = result.get("meter_ticket_ids", [])

            await db["billing_cycle_runs"].update_one(
                {"_id": cycle_run_oid},
                {"$set": {
                    "status": final_status,
                    "invoices_created": result["invoices_created"],
                    "invoices_skipped": result["invoices_skipped"],
                    "invoices_failed": result["invoices_failed"],
                    "failures": result["failures"],
                    "meter_ticket_ids": meter_ticket_ids,
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                }},
            )

            if job_id:
                await db["job_runs"].update_one(
                    {"_id": _to_oid(job_id)},
                    {"$set": {
                        "status": "completed",
                        "result": {
                            "billing_cycle_run_id": cycle_run_id,
                            "meter_ticket_ids": meter_ticket_ids,
                            **result,
                        },
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    }},
                )

            logger.info(
                "action",
                action="billing_run_completed",
                resource_type="billing_run",
                resource_id=job_id,
                org_id=org_id,
                billing_month=billing_month,
                invoices_created=result["invoices_created"],
                invoices_skipped=result["invoices_skipped"],
                status="success",
            )

            # Build WS notification message
            ticket_note = ""
            if meter_ticket_ids:
                ticket_note = f" · {len(meter_ticket_ids)} meter reading ticket(s) created"

            # Publish WebSocket notification to all connected clients for this org
            await _publish_ws_notification(
                org_id=org_id,
                event_type="billing_run_completed",
                title="Billing Run Complete",
                message=(
                    f"{result['invoices_created']} invoices created, "
                    f"{result['invoices_skipped']} skipped"
                    + (f", {result['invoices_failed']} failed" if result['invoices_failed'] else "")
                    + ticket_note
                ),
                data={
                    "job_id": job_id,
                    "run_id": cycle_run_id,
                    "billing_month": billing_month,
                    "invoices_created": result["invoices_created"],
                    "invoices_skipped": result["invoices_skipped"],
                    "invoices_failed": result["invoices_failed"],
                    "meter_ticket_ids": meter_ticket_ids,
                },
            )

        except Exception as exc:
            _org_id = payload.get("org_id") if payload else None
            _job_id = payload.get("job_id") or payload.get("event_id") if payload else None

            logger.error(
                "action",
                action="billing_run_failed",
                resource_type="billing_run",
                resource_id=_job_id,
                org_id=_org_id,
                status="error",
                error_code="BILLING_RUN_ERROR",
                exc_info=exc,
            )

            db = get_db()
            if _job_id:
                await db["job_runs"].update_one(
                    {"_id": _to_oid(_job_id)},
                    {"$set": {
                        "status": "failed",
                        "error": str(exc),
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    }},
                )

            # Publish failure notification
            if _org_id:
                await _publish_ws_notification(
                    org_id=_org_id,
                    event_type="billing_run_failed",
                    title="Billing Run Failed",
                    message=f"Error: {exc}",
                    data={"job_id": _job_id, "error": str(exc)},
                )
            raise


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(task_metrics_wrap(QUEUE_NAME, "billing_run", handle))
