"""Invoice service — CRUD + lifecycle operations for invoices."""
import asyncio
import uuid
from datetime import date
from typing import List, Optional

import structlog
from beanie import Document, PydanticObjectId
from app.core.email import _base, send_email
from app.core.s3 import download_file, generate_presigned_url, s3_path, upload_file
from app.core.exceptions import ConflictError, ForbiddenError, ResourceNotFoundError, ValidationError
from app.dependencies.auth import CurrentUser
from app.models.invoice import BillingCycleRun, Invoice
from app.models.ledger_entry import LedgerEntry
from app.models.payment import Payment
from app.repositories.invoice_repository import BillingRunRepository, billing_run_repository, invoice_repository, vacancy_report_repository
from app.repositories.ledger_repository import ledger_repository
from app.repositories.org_repository import org_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.property_repository import property_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.schemas.invoice import (
    BillingCycleRunListResponse,
    BillingCycleRunResponse,
    InvoiceCountsResponse,
    InvoiceListResponse,
    InvoicePaymentRequest,
    InvoiceResponse,
    InvoiceUpdateRequest,
    TierBandResponse,
)
from app.utils.datetime import utc_now
from bson import ObjectId
logger = structlog.get_logger(__name__)


async def _enrich_invoice(invoice: Invoice) -> InvoiceResponse:
    """Build InvoiceResponse with denormalised names."""
    async def _prop_name():
        try:
            p = await property_repository.get_by_id(invoice.property_id, invoice.org_id)
            return p.name if p else None
        except Exception:
            return None

    async def _unit_label():
        try:
            u = await unit_repository.get_by_id(invoice.unit_id, invoice.org_id)
            return u.unit_code if u else None
        except Exception:
            return None

    async def _tenant_name():
        try:
            u = await user_repository.get_by_id(invoice.tenant_id)
            return f"{u.first_name} {u.last_name}".strip() if u else None
        except Exception:
            return None

    prop_name, unit_label, tenant_name = await asyncio.gather(
        _prop_name(), _unit_label(), _tenant_name()
    )

    from app.schemas.invoice import InvoiceLineItemResponse

    async def _make_line_item(li) -> InvoiceLineItemResponse:
        meter_image_url = await generate_presigned_url(li.meter_image_key) if li.meter_image_key else None
        tier_breakdown = None
        if li.tiers and li.type == "metered_utility" and li.status == "confirmed" and li.quantity > 0:
            tier_breakdown = []
            remaining = li.quantity
            for tier in sorted(li.tiers, key=lambda t: t.from_units):
                if remaining <= 0:
                    break
                lower = tier.from_units
                if tier.to_units is None:
                    band_units = remaining
                    band_label = f"{lower:g}+ units"
                else:
                    band_units = min(remaining, tier.to_units - lower)
                    band_label = f"{lower:g}–{tier.to_units:g} units"
                if band_units <= 0:
                    continue
                tier_breakdown.append(TierBandResponse(
                    band=band_label,
                    units=round(band_units, 4),
                    rate=tier.rate,
                    subtotal=round(band_units * tier.rate, 4),
                ))
                remaining -= band_units
        return InvoiceLineItemResponse(
            id=li.id,
            type=li.type,
            description=li.description,
            utility_key=li.utility_key,
            quantity=li.quantity,
            unit_price=li.unit_price,
            amount=li.amount,
            meter_ticket_id=li.meter_ticket_id,
            current_reading=li.current_reading,
            previous_reading=li.previous_reading,
            meter_image_url=meter_image_url,
            status=li.status,
            tier_breakdown=tier_breakdown,
        )

    line_items = await asyncio.gather(*[_make_line_item(li) for li in invoice.line_items])

    return InvoiceResponse(
        id=str(invoice.id),
        org_id=invoice.org_id,
        property_id=invoice.property_id,
        unit_id=invoice.unit_id,
        lease_id=invoice.lease_id,
        tenant_id=invoice.tenant_id,
        idempotency_key=invoice.idempotency_key,
        billing_month=invoice.billing_month,
        invoice_category=getattr(invoice, "invoice_category", "rent"),
        status=invoice.status,
        sandbox=invoice.sandbox,
        reference_no=invoice.reference_no,
        due_date=invoice.due_date,
        line_items=list(line_items),
        subtotal=invoice.subtotal,
        tax_amount=invoice.tax_amount,
        total_amount=invoice.total_amount,
        amount_paid=invoice.amount_paid,
        balance_due=invoice.balance_due,
        carried_forward=invoice.carried_forward,
        notes=invoice.notes,
        sent_at=invoice.sent_at,
        paid_at=invoice.paid_at,
        created_by=invoice.created_by,
        created_at=invoice.created_at,
        updated_at=invoice.updated_at,
        property_name=prop_name,
        unit_label=unit_label,
        tenant_name=tenant_name,
    )


def _run_to_response(run: BillingCycleRun) -> BillingCycleRunResponse:

    
    run_id = str(run.id) if isinstance(run.id, ObjectId) else run.id

    return BillingCycleRunResponse(
        id=run_id,
        org_id=run.org_id,
        billing_month=run.billing_month,
        run_type=run.run_type,
        sandbox=run.sandbox,
        triggered_by=run.triggered_by,
        status=run.status,
        invoices_created=run.invoices_created,
        invoices_skipped=run.invoices_skipped,
        invoices_failed=run.invoices_failed,
        dry_run_preview=run.dry_run_preview,
        failures=run.failures,
        started_at=run.started_at,
        completed_at=run.completed_at,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def _check_role(current_user: CurrentUser, allowed_roles: List[str]) -> None:
    if current_user.role not in allowed_roles:
        raise ForbiddenError(f"Role '{current_user.role}' cannot perform this action")


async def get_invoice(invoice_id: str, current_user: CurrentUser) -> InvoiceResponse:
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    # Tenants may only view their own invoices
    if current_user.role == "tenant" and invoice.tenant_id != current_user.user_id:
        raise ForbiddenError("You can only view your own invoices")
    return await _enrich_invoice(invoice)


async def list_invoices(
    current_user: CurrentUser,
    billing_month: Optional[str] = None,
    property_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    lease_id: Optional[str] = None,
    status: Optional[str] = None,
    sandbox: Optional[bool] = None,
    invoice_category: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> InvoiceListResponse:
    filter_tenant_id = tenant_id
    if current_user.role == "tenant":
        filter_tenant_id = current_user.user_id

    items, total = await invoice_repository.list(
        org_id=current_user.org_id,
        billing_month=billing_month,
        property_id=property_id,
        tenant_id=filter_tenant_id,
        lease_id=lease_id,
        status=status,
        sandbox=sandbox,
        invoice_category=invoice_category,
        page=page,
        page_size=page_size,
    )
    enriched = await asyncio.gather(*[_enrich_invoice(inv) for inv in items])
    return InvoiceListResponse(items=list(enriched), total=total, page=page, page_size=page_size)


async def get_counts(
    current_user: CurrentUser,
    billing_month: Optional[str] = None,
    sandbox: Optional[bool] = None,
) -> InvoiceCountsResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    counts = await invoice_repository.count_by_status(
        current_user.org_id, billing_month=billing_month, sandbox=sandbox,
        invoice_category="rent",
    )
    total = sum(counts.values())
    return InvoiceCountsResponse(
        draft=counts.get("draft", 0),
        ready=counts.get("ready", 0),
        sent=counts.get("sent", 0),
        partial_paid=counts.get("partial_paid", 0),
        paid=counts.get("paid", 0),
        overdue=counts.get("overdue", 0),
        void=counts.get("void", 0),
        total=total,
    )


_LOCKED_STATUSES = {"sent", "partial_paid", "paid", "overdue"}


async def update_invoice(
    invoice_id: str,
    request: InvoiceUpdateRequest,
    current_user: CurrentUser,
) -> InvoiceResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if invoice.status == "void":
        raise ValidationError("Cannot update a voided invoice")
    if invoice.status in _LOCKED_STATUSES and current_user.role not in ("owner", "superadmin"):
        raise ForbiddenError("This invoice has been sent and is locked. Only the property owner can modify it.")

    fields: dict = {}
    if request.status is not None:
        valid = {"draft", "ready", "sent", "partial_paid", "paid", "overdue", "void"}
        if request.status not in valid:
            raise ValidationError(f"Invalid status: {request.status}")
        fields["status"] = request.status
    if request.notes is not None:
        fields["notes"] = request.notes
    if request.due_date is not None:
        fields["due_date"] = request.due_date

    await invoice_repository.update(invoice, fields)
    updated = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    return await _enrich_invoice(updated)


async def send_invoice(invoice_id: str, current_user: CurrentUser) -> InvoiceResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if invoice.status == "void":
        raise ValidationError("Cannot send a voided invoice")

    # For superadmin (org_id=None), use the invoice's own org for sub-lookups
    eff_org = current_user.org_id or invoice.org_id

    # Fetch context for PDF generation (in parallel)
    org, property_obj, tenant, unit = await asyncio.gather(
        org_repository.get_or_create(eff_org),
        property_repository.get_by_id(invoice.property_id, eff_org),
        user_repository.get_by_id(invoice.tenant_id),
        unit_repository.get_by_id(invoice.unit_id, eff_org),
    )
    currency = (org.ledger_settings and org.ledger_settings.currency_symbol) or "KES"
    tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"
    unit_label = unit.unit_code if unit else "—"

    # Fetch last 12 months of usage history for this lease
    usage_history = await invoice_repository.get_lease_history(
        lease_id=invoice.lease_id, org_id=eff_org, limit=13
    )

    # Generate (or restore from S3 cache) the invoice PDF
    pdf_bytes: Optional[bytes] = None
    if invoice.pdf_key:
        try:
            pdf_bytes = await download_file(invoice.pdf_key)
        except Exception:
            pdf_bytes = None  # cache miss — fall through to regenerate

    if not pdf_bytes:
        try:
            from app.services.invoice_pdf_service import build_invoice_pdf
            pdf_bytes = await build_invoice_pdf(
                invoice=invoice,
                property_obj=property_obj,
                tenant_name=tenant_name,
                unit_label=unit_label,
                org_name=org.business.name if org and org.business else "",
                currency=currency,
                usage_history=usage_history,
            )
            # Persist to S3 so subsequent sends and WA delivery skip regeneration
            if pdf_bytes:
                month_slug = invoice.billing_month.replace("-", "")
                pdf_s3_key = s3_path(
                    eff_org, "invoices", invoice_id,
                    f"{invoice.reference_no}_{month_slug}.pdf",
                )
                await upload_file(pdf_s3_key, pdf_bytes, "application/pdf")
                await invoice_repository.update(invoice, {"pdf_key": pdf_s3_key})
        except Exception as exc:
            logger.warning("invoice_pdf_failed", invoice_id=invoice_id, error=str(exc))

    # Pretty-print billing month
    billing_month_label = invoice.billing_month
    try:
        from datetime import date as _d
        y, mo = int(invoice.billing_month[:4]), int(invoice.billing_month[5:7])
        billing_month_label = _d(y, mo, 1).strftime("%B %Y")
    except Exception:
        pass

    # Build HTML email body
    line_rows = "".join(
        f"<tr><td style='padding:6px 8px;border-bottom:1px solid #f3f4f6'>{li.description}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right'>"
        f"{currency} {li.amount:,.2f}</td></tr>"
        for li in invoice.line_items
        if li.status == "confirmed"
    )
    pdf_note = " A detailed PDF invoice with usage history is attached." if pdf_bytes else ""
    prop_name = property_obj.name if property_obj else ""
    tax_row = (
        f"<tr><td style='padding:4px 8px;color:#6b7280'>Tax</td>"
        f"<td style='padding:4px 8px;text-align:right;color:#6b7280'>{currency} {invoice.tax_amount:,.2f}</td></tr>"
        if invoice.tax_amount else ""
    )
    paid_row = (
        f"<tr><td style='padding:4px 8px;color:#059669'>Amount Paid</td>"
        f"<td style='padding:4px 8px;text-align:right;color:#059669'>{currency} {invoice.amount_paid:,.2f}</td></tr>"
        if invoice.amount_paid else ""
    )
    html = _base(
        f"Invoice {invoice.reference_no}",
        f"""<h2>Invoice {invoice.reference_no}</h2>
<p>Dear <strong>{tenant_name}</strong>,</p>
<p>Please find your invoice for <strong>{billing_month_label}</strong> from <strong>{prop_name}</strong>, Unit <strong>{unit_label}</strong>.{pdf_note}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
  <thead><tr style="background:#f3f4f6">
    <th style="text-align:left;padding:8px;font-size:13px;color:#374151">Description</th>
    <th style="text-align:right;padding:8px;font-size:13px;color:#374151">Amount</th>
  </tr></thead>
  <tbody>{line_rows}</tbody>
  <tfoot>
    <tr><td style="padding:6px 8px;font-weight:600">Subtotal</td><td style="padding:6px 8px;text-align:right">{currency} {invoice.subtotal:,.2f}</td></tr>
    {tax_row}
    <tr style="background:#eff6ff"><td style="padding:8px;font-weight:700;font-size:15px">Total</td><td style="padding:8px;text-align:right;font-weight:700;font-size:15px">{currency} {invoice.total_amount:,.2f}</td></tr>
    {paid_row}
    <tr style="background:#fef2f2"><td style="padding:8px;font-weight:700;color:#dc2626">Balance Due</td><td style="padding:8px;text-align:right;font-weight:700;color:#dc2626">{currency} {invoice.balance_due:,.2f}</td></tr>
  </tfoot>
</table>
<p style="margin-top:20px;color:#6b7280">Please make payment by <strong>{invoice.due_date}</strong> to avoid late fees.</p>""",
    )

    attachments = []
    if pdf_bytes:
        month_slug = invoice.billing_month.replace("-", "")
        attachments.append({
            "filename": f"Invoice_{invoice.reference_no}_{month_slug}.pdf",
            "content": pdf_bytes,
        })

    if tenant and tenant.email:
        await send_email(
            to=str(tenant.email),
            subject=f"Invoice {invoice.reference_no} — {billing_month_label}",
            html=html,
            attachments=attachments or None,
        )

    # Only update status/sent_at on the first send (draft/ready → sent).
    # Resending an already-sent invoice just re-emails without mutating state.
    if invoice.status not in _LOCKED_STATUSES:
        await invoice_repository.update(invoice, {"status": "sent", "sent_at": utc_now()})
    updated = await invoice_repository.get_by_id(invoice_id, eff_org)
    logger.info("invoice_sent", action="send_invoice", resource_type="invoice",
                resource_id=invoice_id, org_id=eff_org,
                user_id=current_user.user_id, status="success")
    return await _enrich_invoice(updated)


async def generate_invoice_pdf_download(invoice_id: str, current_user: CurrentUser) -> bytes:
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if current_user.role == "tenant" and invoice.tenant_id != current_user.user_id:
        raise ForbiddenError("You can only access your own invoices")

    eff_org = current_user.org_id or invoice.org_id

    # Return cached PDF if available
    if invoice.pdf_key:
        try:
            return await download_file(invoice.pdf_key)
        except Exception:
            pass  # fall through to regenerate

    org, property_obj, tenant, unit = await asyncio.gather(
        org_repository.get_or_create(eff_org),
        property_repository.get_by_id(invoice.property_id, eff_org),
        user_repository.get_by_id(invoice.tenant_id),
        unit_repository.get_by_id(invoice.unit_id, eff_org),
    )
    currency = (org.ledger_settings and org.ledger_settings.currency_symbol) or "KES"
    tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else "—"
    unit_label = unit.unit_code if unit else "—"

    usage_history = await invoice_repository.get_lease_history(
        lease_id=invoice.lease_id, org_id=eff_org, limit=13
    )

    from app.services.invoice_pdf_service import build_invoice_pdf
    pdf_bytes = await build_invoice_pdf(
        invoice=invoice,
        property_obj=property_obj,
        tenant_name=tenant_name,
        unit_label=unit_label,
        org_name=org.business.name if org and org.business else "",
        currency=currency,
        usage_history=usage_history,
    )

    # Cache to S3 for future requests
    try:
        month_slug = invoice.billing_month.replace("-", "")
        pdf_s3_key = s3_path(
            eff_org, "invoices", invoice_id,
            f"{invoice.reference_no}_{month_slug}.pdf",
        )
        await upload_file(pdf_s3_key, pdf_bytes, "application/pdf")
        await invoice_repository.update(invoice, {"pdf_key": pdf_s3_key})
    except Exception as exc:
        logger.warning("invoice_pdf_cache_failed", invoice_id=invoice_id, error=str(exc))

    return pdf_bytes


async def create_deposit_invoice(lease, org_id: str) -> Optional[Invoice]:
    """Create and send a deposit invoice when a lease is activated.

    Idempotent: uses idempotency_key=f"{lease_id}:deposit".
    Returns the existing invoice if already created.
    Does NOT raise — caller should wrap in try/except.
    """
    from app.models.invoice import InvoiceLineItem
    from datetime import timedelta

    lease_id = str(lease.id)
    idempotency_key = f"{lease_id}:deposit"

    # Check idempotency
    existing = await Invoice.find_one({"idempotency_key": idempotency_key, "deleted_at": None})
    if existing:
        return existing

    # Build deposit amount
    deposit_amount = float(lease.deposit or 0)
    utility_deposit = float(lease.utility_deposit or 0) if hasattr(lease, "utility_deposit") else 0.0
    total_deposit = deposit_amount + utility_deposit
    if total_deposit <= 0:
        return None

    # Reference number
    reference_no = await invoice_repository.next_reference_number(org_id, "DEP")

    # Due date: lease start date or today
    from datetime import date as _date
    try:
        start = lease.start_date if isinstance(lease.start_date, _date) else _date.fromisoformat(str(lease.start_date))
    except Exception:
        start = _date.today()
    due_date = start

    # Billing month uses the lease start month
    billing_month = start.strftime("%Y-%m")

    line_items: list = []
    if deposit_amount > 0:
        line_items.append(InvoiceLineItem(
            type="deposit",
            description="Security Deposit",
            quantity=1.0,
            unit_price=deposit_amount,
            amount=deposit_amount,
            status="confirmed",
        ))
    if utility_deposit > 0:
        line_items.append(InvoiceLineItem(
            type="utility_deposit",
            description="Utility Deposit",
            quantity=1.0,
            unit_price=utility_deposit,
            amount=utility_deposit,
            status="confirmed",
        ))

    invoice = Invoice(
        org_id=org_id,
        property_id=str(lease.property_id),
        unit_id=str(lease.unit_id),
        lease_id=lease_id,
        tenant_id=str(lease.tenant_id),
        idempotency_key=idempotency_key,
        billing_month=billing_month,
        invoice_category="deposit",
        status="ready",
        sandbox=False,
        reference_no=reference_no,
        due_date=due_date,
        line_items=line_items,
        subtotal=total_deposit,
        tax_amount=0.0,
        total_amount=total_deposit,
        amount_paid=0.0,
        balance_due=total_deposit,
        carried_forward=0.0,
        created_by="system",
    )
    await invoice.insert()

    # Send email best-effort
    try:
        tenant = await user_repository.get_by_id(str(lease.tenant_id))
        org = await org_repository.get_or_create(org_id)
        prop = await property_repository.get_by_id(str(lease.property_id), org_id)
        unit = await unit_repository.get_by_id(str(lease.unit_id), org_id)
        if tenant and tenant.email:
            currency = (org.ledger_settings and org.ledger_settings.currency_symbol) or "KES"
            tenant_name = f"{tenant.first_name} {tenant.last_name}".strip()
            prop_name = prop.name if prop else ""
            unit_label = unit.unit_code if unit else ""
            line_rows = "".join(
                f"<tr><td style='padding:6px 8px;border-bottom:1px solid #f3f4f6'>{li.description}</td>"
                f"<td style='padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right'>"
                f"{currency} {li.amount:,.2f}</td></tr>"
                for li in line_items
            )
            html = _base(
                tenant_name,
                f"""<p>Please find your security deposit invoice for your tenancy at <strong>{prop_name}</strong>, Unit <strong>{unit_label}</strong>.</p>
<table style='width:100%;border-collapse:collapse;margin:16px 0'>
  <thead><tr>
    <th style='text-align:left;padding:8px;background:#f9fafb;font-size:13px'>Description</th>
    <th style='text-align:right;padding:8px;background:#f9fafb;font-size:13px'>Amount</th>
  </tr></thead>
  <tbody>{line_rows}</tbody>
</table>
<p><strong>Total Due: {currency} {total_deposit:,.2f}</strong></p>
<p style='color:#6b7280;font-size:13px'>Reference: {reference_no} &bull; Due: {due_date.strftime('%d %b %Y')}</p>""",
            )
            await send_email(
                to=str(tenant.email),
                subject=f"Deposit Invoice {reference_no} — {prop_name}",
                html=html,
            )
            await invoice_repository.update(invoice, {"status": "sent", "sent_at": utc_now()})
    except Exception as exc:
        logger.warning("deposit_invoice_email_failed", lease_id=lease_id, org_id=org_id, error=str(exc))

    return invoice


async def record_invoice_payment(
    invoice_id: str,
    request: InvoicePaymentRequest,
    current_user: CurrentUser,
) -> InvoiceResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    invoice = await invoice_repository.get_by_id(str(invoice_id), current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if invoice.status == "void":
        raise ValidationError("Cannot record payment on a voided invoice")
    if request.amount <= 0:
        raise ValidationError("Payment amount must be positive")

    # Map invoice line item types to payment categories
    _LINE_ITEM_CATEGORY: dict[str, str] = {
        "rent": "rent",
        "metered_utility": "utility",
        "flat_utility": "utility",
        "utility": "utility",
        "late_fee": "late_fee",
        "termination_fee": "termination_fee",
        "deposit": "deposit",
        "utility_deposit": "utility_deposit",
    }

    # Compute per-category totals from invoice line items (proportional to payment amount)
    # If the payment is partial, scale each bucket proportionally.
    invoice_total = invoice.total_amount or request.amount
    scale = request.amount / invoice_total if invoice_total else 1.0
    category_amounts: dict[str, float] = {}
    for li in (invoice.line_items or []):
        cat = _LINE_ITEM_CATEGORY.get(li.type, "rent")
        category_amounts[cat] = round(category_amounts.get(cat, 0.0) + li.amount * scale, 2)

    # Ensure rounding doesn't leave a gap — assign residual to the first category
    if category_amounts:
        diff = round(request.amount - sum(category_amounts.values()), 2)
        first_key = next(iter(category_amounts))
        category_amounts[first_key] = round(category_amounts[first_key] + diff, 2)
    else:
        # Fallback: single rent payment for the full amount
        category_amounts = {"rent": request.amount}

    # Create one Payment record per category bucket; keep the first as the "primary" for email/receipt
    payment = None
    for cat, amt in category_amounts.items():
        if amt <= 0:
            continue
        p = Payment(
            org_id=current_user.org_id,
            lease_id=invoice.lease_id,
            property_id=invoice.property_id,
            unit_id=invoice.unit_id,
            tenant_id=invoice.tenant_id,
            invoice_id=str(invoice.id),
            category=cat,
            method=request.method,
            direction="inbound",
            amount=amt,
            status="completed",
            notes=request.notes,
            recorded_by=current_user.user_id,
            payment_date=request.payment_date,
            mpesa_checkout_request_id=f"ws_{uuid.uuid4().hex[:8]}",
        )
        await payment_repository.create(p)
        if payment is None:
            payment = p  # first record used for receipt/email reference

    # One ledger entry for the full payment amount
    ledger_balance = await ledger_repository.last_balance(invoice.lease_id, current_user.org_id)
    ledger_entry = LedgerEntry(
        org_id=current_user.org_id,
        lease_id=str(invoice.lease_id),
        property_id=invoice.property_id,
        tenant_id=invoice.tenant_id,
        payment_id=str(payment.id),
        type="credit",
        category="rent",
        amount=request.amount,
        description=f"Payment recorded against lease {invoice.lease_id}",
        running_balance=ledger_balance - request.amount,
    )
    await ledger_repository.create(ledger_entry)

    # FIFO: distribute across outstanding invoices oldest-first
    # Use invoice_category to keep rent and deposit pools isolated
    outstanding = await invoice_repository.list_outstanding_for_lease(
        lease_id=invoice.lease_id,
        org_id=current_user.org_id,
        invoice_category=getattr(invoice, "invoice_category", "rent"),
    )
    # Ensure the selected invoice is in the list even if it somehow isn't
    outstanding_ids = {str(inv.id) for inv in outstanding}
    if str(invoice.id) not in outstanding_ids and invoice.status not in ("paid", "void"):
        outstanding = [invoice] + outstanding

    remaining = request.amount
    now = utc_now()
    applied_payments: list = []  # (Invoice snapshot after update, amount_applied)
    for inv in outstanding:
        if remaining <= 0:
            break
        apply = min(remaining, inv.balance_due)
        new_paid = inv.amount_paid + apply
        new_bal = max(0.0, inv.total_amount - new_paid)
        new_status = "paid" if new_bal <= 0 else "partial_paid"
        update_fields: dict = {
            "amount_paid": new_paid,
            "balance_due": new_bal,
            "status": new_status,
        }
        if new_status == "paid":
            update_fields["paid_at"] = now
        await invoice_repository.update(inv, update_fields)
        # Capture post-update balance_due for the receipt
        inv.balance_due = new_bal
        applied_payments.append((inv, apply))
        remaining -= apply

    # Send thank-you email with receipt PDF (best-effort — don't fail payment on email error)
    try:
        org, property_obj, tenant, unit = await asyncio.gather(
            org_repository.get_or_create(current_user.org_id),
            property_repository.get_by_id(invoice.property_id, current_user.org_id),
            user_repository.get_by_id(invoice.tenant_id),
            unit_repository.get_by_id(invoice.unit_id, current_user.org_id),
        )
        if tenant and tenant.email:
            currency = (org.ledger_settings and org.ledger_settings.currency_symbol) or "KES"
            tenant_name = f"{tenant.first_name} {tenant.last_name}".strip()
            unit_label = unit.unit_code if unit else "—"
            org_name = org.business.name if org and org.business else ""

            from app.services.invoice_pdf_service import build_payment_receipt_pdf
            from app.core.email import _base, send_email
            pdf_bytes = await build_payment_receipt_pdf(
                payment=payment,
                applied_invoices=applied_payments,
                property_obj=property_obj,
                tenant_name=tenant_name,
                unit_label=unit_label,
                org_name=org_name,
                currency=currency,
            )

            total_balance = sum(inv.balance_due for inv, _ in applied_payments)
            balance_note = (
                f"Your outstanding balance is now <strong>{currency} {total_balance:,.2f}</strong>."
                if total_balance > 0 else
                "Your account is fully settled. Thank you!"
            )
            def _month_label(m: str) -> str:
                try:
                    from datetime import date as _d2
                    y, mo = int(m[:4]), int(m[5:7])
                    return _d2(y, mo, 1).strftime("%B %Y")
                except Exception:
                    return m

            inv_list_html = "".join(
                f"<tr><td style='padding:5px 8px;border-bottom:1px solid #f3f4f6'>{inv.reference_no} "
                f"({_month_label(inv.billing_month)})</td>"
                f"<td style='padding:5px 8px;border-bottom:1px solid #f3f4f6;text-align:right'>"
                f"{currency} {amt:,.2f}</td></tr>"
                for inv, amt in applied_payments
            )
            html = _base(
                "Payment Received",
                f"""<h2>Payment Received</h2>
<p>Dear <strong>{tenant_name}</strong>,</p>
<p>Thank you for your payment of <strong>{currency} {float(payment.amount):,.2f}</strong>
received on <strong>{payment.payment_date}</strong> via <strong>{str(payment.method).replace('_', ' ').title()}</strong>.</p>
<table width="100%" cellpadding="0" cellspacing="0"
       style="border-collapse:collapse;margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
  <thead><tr style="background:#f3f4f6">
    <th style="text-align:left;padding:8px;font-size:13px;color:#374151">Invoice</th>
    <th style="text-align:right;padding:8px;font-size:13px;color:#374151">Applied</th>
  </tr></thead>
  <tbody>{inv_list_html}</tbody>
</table>
<p style="margin-top:16px">{balance_note}</p>
<p style="color:#6b7280;font-size:13px">A PDF receipt is attached for your records.</p>""",
            )
            receipt_no = f"RCT-{str(payment.id)[:8].upper()}"
            await send_email(
                to=str(tenant.email),
                subject=f"Payment Receipt {receipt_no} — {property_obj.name if property_obj else ''}",
                html=html,
                attachments=[{
                    "filename": f"Receipt_{receipt_no}.pdf",
                    "content": pdf_bytes,
                }],
            )
    except Exception as exc:
        logger.warning("payment_receipt_email_failed", invoice_id=invoice_id,
                       org_id=current_user.org_id, error=str(exc))

    updated = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    logger.info("invoice_payment_recorded", action="record_invoice_payment",
                resource_type="invoice", resource_id=invoice_id,
                org_id=current_user.org_id, user_id=current_user.user_id,
                amount=request.amount, status="success")
    return await _enrich_invoice(updated)


async def send_proforma(invoice_id: str, current_user: CurrentUser) -> None:
    """Mark invoice as proforma and email it to the tenant for review."""
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if invoice.status not in ("draft", "ready"):
        raise ValidationError("Proforma can only be sent for draft or ready invoices")

    invoice.is_proforma = True
    invoice.updated_at = utc_now()
    await invoice.save()

    # Send email to tenant (best-effort)
    try:
        tenant = await user_repository.get_by_id(invoice.tenant_id)
        prop = await property_repository.get_by_id(invoice.property_id, current_user.org_id)
        unit = await unit_repository.get_by_id(invoice.unit_id, current_user.org_id)
        org = await org_repository.get_or_create(current_user.org_id)
        if tenant and tenant.email:
            currency = (org.ledger_settings and org.ledger_settings.currency_symbol) or "KES"
            tenant_name = f"{tenant.first_name} {tenant.last_name}".strip()
            unit_label = unit.unit_code if unit else ""
            prop_name = prop.name if prop else ""
            line_rows = "".join(
                f"<tr><td style='padding:6px 8px;border-bottom:1px solid #f3f4f6'>{li.description}</td>"
                f"<td style='padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right'>"
                f"{currency} {li.amount:,.2f}</td></tr>"
                for li in (invoice.line_items or [])
            )
            html = _base(
                "Proforma Invoice for Review",
                f"""<h2>Proforma Invoice — For Review Only</h2>
<p>Dear <strong>{tenant_name}</strong>,</p>
<p>Please review the upcoming invoice for <strong>{unit_label}</strong>.
This is a proforma and not yet due for payment. Please contact us if you have any queries before
the final invoice is issued.</p>
<table width="100%" style="border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:8px">
  <thead><tr style="background:#f3f4f6">
    <th style="text-align:left;padding:8px;font-size:13px">Description</th>
    <th style="text-align:right;padding:8px;font-size:13px">Amount</th>
  </tr></thead>
  <tbody>{line_rows}</tbody>
  <tfoot><tr style="font-weight:600">
    <td style="padding:8px;border-top:2px solid #e5e7eb">Total</td>
    <td style="padding:8px;border-top:2px solid #e5e7eb;text-align:right">{currency} {invoice.total_amount:,.2f}</td>
  </tr></tfoot>
</table>
<p style="color:#6b7280;font-size:13px">This is a proforma invoice and does not require immediate payment.</p>""",
            )
            await send_email(
                to=str(tenant.email),
                subject=f"Proforma Invoice {invoice.reference_no} — {prop_name}",
                html=html,
            )
    except Exception as exc:
        logger.warning("proforma_email_failed", invoice_id=invoice_id, error=str(exc))

    logger.info(
        "proforma_sent",
        action="send_proforma",
        resource_type="invoice",
        resource_id=invoice_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )


async def void_invoice(invoice_id: str, current_user: CurrentUser) -> None:
    _check_role(current_user, ["owner", "superadmin"])
    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        raise ResourceNotFoundError("Invoice", invoice_id)
    if invoice.status == "void":
        raise ConflictError("Invoice is already voided")
    if invoice.status == "paid":
        raise ValidationError("Cannot void a fully paid invoice")
    await invoice_repository.update(invoice, {"status": "void"})
    logger.info("invoice_voided", action="void_invoice", resource_type="invoice",
                resource_id=invoice_id, org_id=current_user.org_id,
                user_id=current_user.user_id, status="success")


async def list_billing_runs(
    current_user: CurrentUser,
    billing_month: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> BillingCycleRunListResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    items, total = await billing_run_repository.list(
        org_id=current_user.org_id,
        billing_month=billing_month,
        page=page,
        page_size=page_size,
    )
    return BillingCycleRunListResponse(
        items=[_run_to_response(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_billing_run(run_id: str, current_user: CurrentUser) -> BillingCycleRunResponse:
    _check_role(current_user, ["owner", "agent", "superadmin"])
    run = await billing_run_repository.get_by_id(run_id, current_user.org_id)
    if not run:
        raise ResourceNotFoundError("BillingCycleRun", run_id)
    if run and "_id" in run:
       run["_id"] = str(run["_id"])

    return _run_to_response(run)
