"""Billing service — generates invoices for all active leases in a billing month."""
import asyncio
import calendar
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import structlog

from app.core.exceptions import ConflictError
from app.core.redis import get_redis_client
from app.models.invoice import BillingCycleRun, Invoice, InvoiceLineItem, VacancyReport, VacantUnitDetail
from app.models.ledger_entry import LedgerEntry
from app.models.lease import Lease
from app.models.org import Org
from app.models.property import Property, UtilityDetail
from app.models.unit import Unit
from app.models.ticket import Ticket, TicketActivity, TicketTask
from app.repositories.invoice_repository import (
    billing_run_repository,
    invoice_repository,
    vacancy_report_repository,
)
from app.repositories.lease_repository import lease_repository
from app.repositories.ledger_repository import ledger_repository
from app.repositories.org_repository import org_repository
from app.repositories.property_repository import property_repository
from app.repositories.meter_reading_repository import meter_reading_repository
from app.repositories.ticket_repository import ticket_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_LOCK_TTL = 300  # seconds


async def _acquire_lock(key: str) -> bool:
    redis = get_redis_client()
    return await redis.set(key, "1", ex=_LOCK_TTL, nx=True)


async def _release_lock(key: str) -> None:
    redis = get_redis_client()
    await redis.delete(key)


def _billing_month_start(billing_month: str) -> date:
    year, month = map(int, billing_month.split("-"))
    return date(year, month, 1)


def _billing_month_end(billing_month: str) -> date:
    year, month = map(int, billing_month.split("-"))
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, last_day)


_STD_UTILITY_KEYS = ["electricity", "water", "gas", "internet", "garbage", "security"]


def _apply_tiered_rate(tiers: list, consumption: float) -> float:
    """Compute the charge for `consumption` units using a stepped tier schedule.

    Each tier covers [from_units, to_units) at `rate` KES/unit.
    to_units=None means unbounded (last tier).
    Tiers are sorted by from_units before processing.
    """
    if not tiers or consumption <= 0:
        return 0.0
    total = 0.0
    for tier in sorted(tiers, key=lambda t: t.from_units):
        if consumption <= tier.from_units:
            break  # consumption doesn't reach this tier
        upper = min(consumption, tier.to_units) if tier.to_units is not None else consumption
        units_in_band = upper - tier.from_units
        total += units_in_band * tier.rate
    return round(total, 4)


def _effective_utility(key: str, property_: Property, unit: Optional[Unit]) -> Optional[UtilityDetail]:
    """Return unit-level override if set, otherwise fall back to property default."""
    if unit and unit.utility_overrides:
        override = getattr(unit.utility_overrides, key, None)
        if override is not None:
            return override
    return getattr(property_.utility_defaults, key, None)


def _compute_line_items(
    lease: Lease,
    property_: Property,
    unit: Optional[Unit],
    org: Org,
    late_fee: float = 0.0,
) -> List[InvoiceLineItem]:
    items: List[InvoiceLineItem] = []

    # Apply active lease discounts to rent line item
    from datetime import date as _today_date
    today = _today_date.today()
    total_discount = 0.0
    active_discount_labels = []
    for disc in (lease.discounts or []):
        if disc.effective_from <= today and (disc.effective_to is None or disc.effective_to >= today):
            if disc.type == "fixed":
                total_discount += disc.value
            else:
                total_discount += round(lease.rent_amount * disc.value / 100, 2)
            active_discount_labels.append(disc.label)
    discounted_rent = max(0.0, round(lease.rent_amount - total_discount, 2))

    # Rent line item
    items.append(InvoiceLineItem(
        type="rent",
        description="Monthly Rent",
        quantity=1.0,
        unit_price=lease.rent_amount,
        amount=discounted_rent,
        status="confirmed",
    ))

    # Discount line item (transparent — shows the saving)
    if total_discount > 0:
        label_str = ", ".join(active_discount_labels) if active_discount_labels else "Discount"
        items.append(InvoiceLineItem(
            type="discount",
            description=f"Rent Discount — {label_str}",
            quantity=1.0,
            unit_price=-total_discount,
            amount=-total_discount,
            status="confirmed",
        ))

    # Utility line items — unit overrides take precedence over property defaults
    ud = property_.utility_defaults
    std_utils = {key: _effective_utility(key, property_, unit) for key in _STD_UTILITY_KEYS}

    for key, detail in std_utils.items():
        if detail is None:
            continue
        if detail.type == "subscription":
            rate = detail.rate or 0.0
            items.append(InvoiceLineItem(
                type="subscription_utility",
                description=detail.label or key.capitalize(),
                utility_key=key,
                quantity=1.0,
                unit_price=rate,
                amount=rate,
                status="confirmed",
            ))
        elif detail.type == "shared":
            rate = detail.rate or 0.0
            items.append(InvoiceLineItem(
                type="subscription_utility",
                description=f"{detail.label or key.capitalize()} (Shared)",
                utility_key=key,
                quantity=1.0,
                unit_price=rate,
                amount=rate,
                status="confirmed",
            ))
        elif detail.type == "metered":
            # pending — will be updated when meter reading is submitted
            items.append(InvoiceLineItem(
                type="metered_utility",
                description=f"{detail.label or key.capitalize()} (Metered)",
                utility_key=key,
                quantity=0.0,
                unit_price=detail.rate or 0.0,
                amount=0.0,
                tiers=detail.tiers or None,
                status="pending",
            ))

    # Custom utilities
    for custom in ud.custom:
        if custom.type == "subscription":
            rate = custom.rate or 0.0
            items.append(InvoiceLineItem(
                type="subscription_utility",
                description=custom.label or custom.key,
                utility_key=custom.key,
                quantity=1.0,
                unit_price=rate,
                amount=rate,
                status="confirmed",
            ))
        elif custom.type == "metered":
            items.append(InvoiceLineItem(
                type="metered_utility",
                description=f"{custom.label or custom.key} (Metered)",
                utility_key=custom.key,
                quantity=0.0,
                unit_price=custom.rate or 0.0,
                amount=0.0,
                tiers=custom.tiers or None,
                status="pending",
            ))

    # Late fee — added when the property charges a late fee and the tenant has overdue balances
    if late_fee > 0:
        items.append(InvoiceLineItem(
            type="adjustment",
            description="Late Payment Fee",
            quantity=1.0,
            unit_price=late_fee,
            amount=late_fee,
            status="confirmed",
        ))

    return items


def _compute_totals(
    line_items: List[InvoiceLineItem],
    tax_config,
) -> Dict[str, float]:
    subtotal = sum(item.amount for item in line_items if item.status == "confirmed")
    if tax_config.vat_enabled and not tax_config.vat_inclusive:
        tax_amount = subtotal * (tax_config.vat_rate / 100.0)
    else:
        tax_amount = 0.0
    total = subtotal + tax_amount
    return {"subtotal": subtotal, "tax_amount": tax_amount, "total_amount": total}


async def _create_property_meter_ticket(
    org_id: str,
    property_id: str,
    billing_month: str,
    task_infos: List[dict],
    triggered_by: Optional[str],
) -> str:
    """Create ONE meter reading ticket for a property, with one task per unit/utility.

    task_infos items: {invoice_id, line_item_id, unit_id, unit_code, tenant_name,
                       utility_key, utility_label, previous_reading, meter_number}
    Returns the ticket id.
    """
    import secrets as _secrets
    tasks = []
    for info in task_infos:
        tenant_display = info.get("tenant_name") or ""
        unit_display = info.get("unit_code") or info.get("unit_id", "")
        title = f"{info.get('utility_label', info.get('utility_key', 'Meter'))} — {unit_display}"
        if tenant_display:
            title += f" ({tenant_display})"
        tasks.append(TicketTask(
            title=title,
            task_type="meter_reading",
            meter_number=info.get("meter_number"),
            previous_reading=info.get("previous_reading"),
            unit_of_measure="units",
            unit_id=info.get("unit_id"),
            unit_code=info.get("unit_code"),
            tenant_name=info.get("tenant_name"),
            invoice_id=info.get("invoice_id"),
            line_item_id=info.get("line_item_id"),
            utility_key=info.get("utility_key"),
        ))

    # Check if property has a designated meter reader SP
    property_ = await property_repository.get_by_id(property_id, org_id)
    sp_id = property_.meter_settings.meter_reader_service_provider_id if property_ else None

    token = _secrets.token_urlsafe(32)
    ticket = Ticket(
        org_id=org_id,
        property_id=property_id,
        category="utility_reading",
        priority="normal",
        title=f"Meter Readings — {billing_month}",
        description=f"Submit meter readings for all metered units for billing month {billing_month}.",
        tasks=tasks,
        submission_token=token,
        assigned_to=sp_id,
        created_by=triggered_by or "system",
        activity=[TicketActivity(
            type="system",
            description=f"Meter reading ticket created by billing run ({billing_month})",
        )],
    )
    await ticket_repository.create(ticket)

    # Notify the assigned SP — or property owner if no SP configured
    try:
        from app.core.email import _base, send_email
        from app.core.config import settings as _settings
        base_url = _settings.app_base_url.rstrip("/")
        link = f"{base_url}/task/{token}"

        if sp_id:
            assignee = await user_repository.get_by_id(sp_id)
            if assignee and assignee.email:
                action_block = (
                    f'<p>Use the link below to capture meter readings from the field:</p>'
                    f'<a href="{link}?user_id={sp_id}">Start Meter Reading →</a>'
                )
                html = _base(
                    "Meter Reading Assignment",
                    f"""<h2>Meter reading task assigned to you</h2>
<p><strong>Property:</strong> {property_.name if property_ else property_id}</p>
<p><strong>Billing Month:</strong> {billing_month}</p>
<p><strong>Units:</strong> {len(tasks)}</p>
{action_block}""",
                )
                await send_email(to=str(assignee.email), subject=f"Meter Reading Task — {billing_month}", html=html)
        else:
            # No SP configured — notify org owner
            all_users = await user_repository.list_by_org(org_id)
            owner = next((u for u in all_users if u.role == "owner"), None)
            if owner and owner.email:
                html = _base(
                    "Meter Reading Required",
                    f"""<h2>Meter readings needed for {billing_month}</h2>
<p><strong>Property:</strong> {property_.name if property_ else property_id}</p>
<p><strong>Units requiring readings:</strong> {len(tasks)}</p>
<p>No meter reader service provider is configured for this property.
Please assign someone or capture the readings yourself:</p>
<p><a href="{link}">Open Meter Reading Page →</a></p>
<p style="font-size:12px;color:#6b7280;">To configure a default meter reader, go to Property Settings.</p>""",
                )
                await send_email(to=str(owner.email), subject=f"Action Required: Meter Readings — {billing_month}", html=html)
    except Exception:
        pass  # Email failure must not block ticket creation

    return str(ticket.id)


async def generate_invoices_for_month(
    org_id: str,
    billing_month: str,
    sandbox: bool = False,
    dry_run: bool = False,
    triggered_by: Optional[str] = None,
) -> BillingCycleRun:
    """
    Generate invoices for all active leases in the org for the given billing_month.
    Idempotent — skips leases that already have an invoice for the month.
    """
    run_type = "dry_run" if dry_run else ("sandbox" if sandbox else "manual")
    run = BillingCycleRun(
        org_id=org_id,
        billing_month=billing_month,
        run_type=run_type,
        sandbox=sandbox,
        triggered_by=triggered_by or "system",
        status="running",
        started_at=utc_now(),
    )
    await billing_run_repository.create(run)

    lock_key = f"{org_id}:lock:billing_run:{billing_month}"
    if not dry_run:
        locked = await _acquire_lock(lock_key)
        if not locked:
            await billing_run_repository.update(run, {"status": "failed",
                "failures": [{"error": "Another billing run is in progress"}]})
            raise ConflictError("A billing run is already in progress for this month")

    try:
        org = await org_repository.get_or_create(org_id)
        prefix = org.ledger_settings.invoice_prefix
        grace_days = org.billing_config.payment_grace_days
        month_start = _billing_month_start(billing_month)
        due_date = month_start + timedelta(days=grace_days)

        # Fetch all active leases
        leases = await lease_repository.list_active_by_org(org_id)

        # Unit cache — used in every path for utility overrides; also used for labels in dry_run
        _unit_map: Dict[str, Any] = {}
        # Tenant map — only needed for dry_run preview labels
        _tenant_map: Dict[str, Any] = {}
        if dry_run:
            all_tenants = await user_repository.list_by_org(org_id)
            _tenant_map = {str(u.id): u for u in all_tenants}

        preview_list: List[Dict[str, Any]] = []
        invoices_created = 0
        invoices_skipped = 0
        invoices_failed = 0
        failures: List[dict] = []

        # property_id → list of task info dicts (populated during invoice loop)
        property_metered_tasks: Dict[str, List[dict]] = {}
        # invoice_id → Invoice object (to update line_items after ticket creation)
        created_invoices: Dict[str, Invoice] = {}

        for lease in leases:
            sandbox_prefix = "sandbox:" if sandbox else ""
            idempotency_key = f"{sandbox_prefix}{lease.id}:{billing_month}"
            print(f"{idempotency_key}")

            try:
                # Skip if already exists
                existing = await invoice_repository.get_by_idempotency_key(idempotency_key)
                if existing:
                    invoices_skipped += 1
                    continue

                # Carried forward — current ledger running balance.
                # Positive = tenant owes money (debits > credits). Negative = overpaid (credit).
                # Stored as Invoice.carried_forward for display only; NOT included in invoice subtotal.
                # The ledger running_balance accumulates unpaid charges across months correctly.
                ledger_balance = await ledger_repository.last_balance(str(lease.id), org_id)
                carried_forward = max(0.0, round(ledger_balance, 2))

                # Fetch property
                property_ = await property_repository.get_by_id(lease.property_id, org_id)
                if not property_:
                    invoices_failed += 1
                    failures.append({"lease_id": lease.id, "error": "Property not found"})
                    continue

                # Fetch unit (for utility overrides + dry-run labels)
                if lease.unit_id not in _unit_map:
                    _unit_map[lease.unit_id] = await unit_repository.get_by_id(lease.unit_id, org_id)
                unit = _unit_map.get(lease.unit_id)

                # Late fee — apply when property is configured for it and tenant has overdue invoices
                late_fee_value = property_.billing_settings.late_fee_value if property_.billing_settings else 0.0
                late_fee = 0.0
                if late_fee_value > 0 and carried_forward > 0:
                    # Only charge once per billing cycle — check if one wasn't already added last month
                    prev_invoice = await invoice_repository.get_latest_for_lease(
                        lease_id=str(lease.id), org_id=org_id
                    )
                    if prev_invoice and prev_invoice.balance_due > 0:
                        late_fee = late_fee_value

                line_items = _compute_line_items(lease, property_, unit, org, late_fee=late_fee)
                totals = _compute_totals(line_items, org.tax_config)

                if dry_run:
                    # Resolve human-readable names
                    tenant = _tenant_map.get(lease.tenant_id)
                    tenant_name = (
                        f"{tenant.first_name} {tenant.last_name}".strip()
                        if tenant else lease.tenant_id
                    )
                    unit_label = unit.unit_code if unit else lease.unit_id

                    # Enrich metered line items with the last recorded reading
                    enriched_items = []
                    for li in line_items:
                        li_dict = li.model_dump()
                        if li.type == "metered_utility" and li.utility_key and lease.unit_id:
                            cached = (unit.meter_reading_cache or {}).get(li.utility_key) if unit else None
                            if cached:
                                li_dict["prev_reading"] = cached.value
                                li_dict["prev_read_at"] = cached.read_at.isoformat()
                            else:
                                prev = await meter_reading_repository.get_latest(
                                    org_id=org_id,
                                    unit_id=lease.unit_id,
                                    utility_key=li.utility_key,
                                )
                                li_dict["prev_reading"] = prev.current_reading if prev else None
                                li_dict["prev_read_at"] = prev.read_at.isoformat() if prev else None
                        else:
                            li_dict["prev_reading"] = None
                            li_dict["prev_read_at"] = None
                        enriched_items.append(li_dict)

                    preview_list.append({
                        "lease_id": str(lease.id),
                        "tenant_id": lease.tenant_id,
                        "tenant_name": tenant_name,
                        "unit_id": lease.unit_id,
                        "unit_label": unit_label,
                        "property_id": lease.property_id,
                        "property_name": property_.name,
                        "carried_forward": carried_forward,
                        "line_items": enriched_items,
                        **totals,
                        "due_date": str(due_date),
                    })
                    invoices_created += 1
                    continue

                # Generate reference number
                reference_no = await invoice_repository.next_reference_number(org_id, prefix)

                invoice = Invoice(
                    org_id=org_id,
                    property_id=lease.property_id,
                    unit_id=lease.unit_id,
                    lease_id=str(lease.id),
                    tenant_id=lease.tenant_id,
                    idempotency_key=idempotency_key,
                    billing_month=billing_month,
                    status="draft",
                    sandbox=sandbox,
                    reference_no=reference_no,
                    due_date=due_date,
                    carried_forward=carried_forward,
                    created_by=triggered_by or "system",
                    line_items=line_items,
                    balance_due=totals["total_amount"],
                    **totals,
                )
                await invoice_repository.create(invoice)
                created_invoices[invoice.id] = invoice
                invoices_created += 1

                # Debit ledger entry — records the charge against the tenant's account.
                # Must be created here so next month's carried_forward is accurate.
                new_ledger_balance = round(ledger_balance + totals["total_amount"], 2)
                await ledger_repository.create(LedgerEntry(
                    org_id=org_id,
                    lease_id=str(lease.id),
                    property_id=lease.property_id,
                    tenant_id=lease.tenant_id,
                    invoice_id=str(invoice.id),
                    type="debit",
                    category="rent",
                    amount=totals["total_amount"],
                    description=f"Invoice {reference_no} — {billing_month}",
                    running_balance=new_ledger_balance,
                ))

                # Collect metered line items for this property
                tenant_user = await user_repository.get_by_id(lease.tenant_id) if lease.tenant_id else None
                tenant_first = tenant_user.first_name if tenant_user else ""
                unit_code = unit.unit_code if unit else lease.unit_id

                for li in line_items:
                    if li.type == "metered_utility" and li.status == "pending" and li.utility_key:
                        # Fetch previous reading
                        cached = (unit.meter_reading_cache or {}).get(li.utility_key) if unit else None
                        if cached:
                            prev_reading = cached.value
                        else:
                            prev_mr = await meter_reading_repository.get_latest(
                                org_id=org_id,
                                unit_id=lease.unit_id,
                                utility_key=li.utility_key,
                            )
                            prev_reading = prev_mr.current_reading if prev_mr else None

                        prop_key = lease.property_id
                        if prop_key not in property_metered_tasks:
                            property_metered_tasks[prop_key] = []
                        # Use unit's meter_number or default MTR-<unit_code>
                        meter_num = (unit.meter_number if unit and unit.meter_number
                                     else f"MTR-{unit_code}")
                        property_metered_tasks[prop_key].append({
                            "invoice_id": invoice.id,
                            "line_item_id": li.id,
                            "unit_id": lease.unit_id,
                            "unit_code": unit_code,
                            "tenant_name": tenant_first,
                            "utility_key": li.utility_key,
                            "utility_label": li.description.replace(" (Metered)", ""),
                            "previous_reading": prev_reading,
                            "meter_number": meter_num,
                        })

            except Exception as exc:
                invoices_failed += 1
                failures.append({"lease_id": lease.id, "error": str(exc)})
                logger.error(
                    "billing_invoice_failed",
                    action="generate_invoice",
                    resource_type="invoice",
                    org_id=org_id,
                    lease_id=lease.id,
                    status="error",
                    error_code="INVOICE_GENERATION_ERROR",
                )

        # Create ONE meter reading ticket per property, update line items with ticket id
        meter_ticket_ids: List[str] = []
        if not dry_run and property_metered_tasks:
            for property_id, task_infos in property_metered_tasks.items():
                try:
                    ticket_id = await _create_property_meter_ticket(
                        org_id=org_id,
                        property_id=property_id,
                        billing_month=billing_month,
                        task_infos=task_infos,
                        triggered_by=triggered_by,
                    )
                    meter_ticket_ids.append(ticket_id)
                    # Stamp each linked invoice's line items with this ticket id
                    invoice_ids_for_prop = {info["invoice_id"] for info in task_infos}
                    line_item_to_ticket = {info["line_item_id"]: ticket_id for info in task_infos}
                    for inv_id in invoice_ids_for_prop:
                        inv = created_invoices.get(inv_id)
                        if not inv:
                            continue
                        updated_items = [
                            li.model_copy(update={"meter_ticket_id": line_item_to_ticket[li.id]})
                            if li.id in line_item_to_ticket else li
                            for li in inv.line_items
                        ]
                        await invoice_repository.update(inv, {"line_items": [i.model_dump() for i in updated_items]})
                except Exception as exc:
                    logger.warning(
                        "meter_ticket_create_failed",
                        action="create_property_meter_ticket",
                        resource_type="ticket",
                        org_id=org_id,
                        property_id=property_id,
                        status="error",
                    )

        # Build vacancy report (not for dry_run)
        if not dry_run:
            await _build_vacancy_report(org_id, billing_month, run.id)

        # Determine final status
        final_status = "completed"
        if invoices_failed > 0 and invoices_created == 0:
            final_status = "failed"
        elif invoices_failed > 0:
            final_status = "partial"

        update_fields: dict = {
            "status": final_status,
            "invoices_created": invoices_created,
            "invoices_skipped": invoices_skipped,
            "invoices_failed": invoices_failed,
            "failures": failures,
            "meter_ticket_ids": meter_ticket_ids,
            "completed_at": utc_now(),
        }
        if dry_run:
            update_fields["dry_run_preview"] = preview_list

        await billing_run_repository.update(run, update_fields)

        logger.info(
            "billing_run_completed",
            action="generate_invoices_for_month",
            resource_type="billing_cycle_run",
            resource_id=run.id,
            org_id=org_id,
            billing_month=billing_month,
            invoices_created=invoices_created,
            invoices_skipped=invoices_skipped,
            invoices_failed=invoices_failed,
            status="success",
        )
        return run

    except ConflictError:
        raise
    except Exception as exc:
        await billing_run_repository.update(run, {
            "status": "failed",
            "failures": [{"error": str(exc)}],
            "completed_at": utc_now(),
        })
        logger.error(
            "billing_run_failed",
            action="generate_invoices_for_month",
            resource_type="billing_cycle_run",
            resource_id=run.id,
            org_id=org_id,
            status="error",
            error_code="BILLING_RUN_ERROR",
        )
        raise
    finally:
        if not dry_run:
            await _release_lock(lock_key)


async def _build_vacancy_report(org_id: str, billing_month: str, run_id: str) -> None:
    """Build vacancy report for the billing month."""
    try:
        all_units, total_count = await unit_repository.list_by_org(org_id=org_id)
        active_leases = await lease_repository.list_active_by_org(org_id)
        occupied_unit_ids = {l.unit_id for l in active_leases}

        vacant_details: List[VacantUnitDetail] = []
        estimated_lost_rent = 0.0

        for unit in all_units:
            if unit.id not in occupied_unit_ids:
                prop = await property_repository.get_by_id(unit.property_id, org_id)
                prop_name = prop.name if prop else unit.property_id
                base_rent = (
                    prop.pricing_defaults.rent_base
                    if prop and prop.pricing_defaults and prop.pricing_defaults.rent_base
                    else None
                )
                lost = base_rent  # best estimate
                if lost:
                    estimated_lost_rent += lost
                vacant_details.append(VacantUnitDetail(
                    property_id=unit.property_id,
                    property_name=prop_name,
                    unit_id=unit.id,
                    unit_label=unit.unit_code,
                    days_vacant=30,  # approximation for full-month vacancy
                    estimated_rent=base_rent,
                    estimated_lost_rent=lost,
                ))

        occupied = len(occupied_unit_ids)
        total = total_count
        vacant = total - occupied
        rate = (vacant / total) if total > 0 else 0.0

        report = VacancyReport(
            org_id=org_id,
            billing_month=billing_month,
            billing_cycle_run_id=run_id,
            total_units=total,
            occupied_units=occupied,
            vacant_units=vacant,
            vacancy_rate=rate,
            vacant_details=vacant_details,
            estimated_lost_rent=estimated_lost_rent,
        )
        await vacancy_report_repository.create(report)
    except Exception as exc:
        logger.warning(
            "vacancy_report_failed",
            action="build_vacancy_report",
            resource_type="vacancy_report",
            org_id=org_id,
            billing_month=billing_month,
            status="error",
            error_code="VACANCY_REPORT_ERROR",
        )


async def apply_meter_reading_to_invoice(
    invoice_id: str,
    line_item_id: str,
    current_reading: float,
    org_id: str,
    previous_reading: Optional[float] = None,
    meter_image_key: Optional[str] = None,
) -> Invoice:
    """Update a pending metered line item with current reading and recompute totals."""
    invoice = await invoice_repository.get_by_id(invoice_id, org_id)
    if not invoice:
        from app.core.exceptions import ResourceNotFoundError
        raise ResourceNotFoundError("Invoice", invoice_id)

    updated_items = []
    for li in invoice.line_items:
        if li.id == line_item_id and li.status == "pending" and li.type == "metered_utility":
            prev = previous_reading if previous_reading is not None else 0.0
            consumption = max(current_reading - prev, 0)
            if li.tiers:
                amount = _apply_tiered_rate(li.tiers, consumption)
            else:
                amount = consumption * li.unit_price
            updated_items.append(li.model_copy(update={
                "quantity": consumption,
                "amount": amount,
                "status": "confirmed",
                "current_reading": current_reading,
                "previous_reading": previous_reading,
                "meter_image_key": meter_image_key,
            }))
        else:
            updated_items.append(li)

    # Recompute totals
    org = await org_repository.get_or_create(org_id)
    totals = _compute_totals(updated_items, org.tax_config)
    balance_due = totals["total_amount"] - invoice.amount_paid

    all_confirmed = all(li.status == "confirmed" for li in updated_items)
    new_status = "ready" if all_confirmed and invoice.status == "draft" else invoice.status

    await invoice_repository.update(invoice, {
        "line_items": [li.model_dump() for li in updated_items],
        "status": new_status,
        "balance_due": balance_due,
        **totals,
    })
    return await invoice_repository.get_by_id(invoice_id, org_id)


async def mark_invoice_ready_if_complete(invoice_id: str, org_id: str) -> None:
    """Transition invoice to 'ready' if all line items are confirmed."""
    invoice = await invoice_repository.get_by_id(invoice_id, org_id)
    if not invoice or invoice.status != "draft":
        return
    if all(li.status == "confirmed" for li in invoice.line_items):
        await invoice_repository.update(invoice, {"status": "ready"})
