"""Invoice API — billing run trigger, CRUD, lifecycle, payments."""
from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.core.rabbitmq import publish
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.repositories.job_run_repository import job_run_repository
from app.repositories.payment_repository import payment_repository
from app.schemas.invoice import (
    BillingCycleRunListResponse,
    BillingCycleRunResponse,
    BillingRunTriggerResponse,
    InvoiceCountsResponse,
    InvoiceGenerateRequest,
    InvoiceListResponse,
    InvoicePaymentRequest,
    InvoiceResponse,
    InvoiceUpdateRequest,
)
from app.services import billing_service, invoice_service
from app.services.invoice_service import _run_to_response
from app.utils.datetime import utc_now

router = APIRouter(prefix="/invoices", tags=["invoices"])

_QUEUE_BILLING_RUNS = "billing.runs"


@router.post(
    "/generate",
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def trigger_billing_run(
    req: InvoiceGenerateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Union[BillingCycleRunResponse, BillingRunTriggerResponse]:
    """Trigger invoice generation for a billing month.

    - dry_run=True  → runs inline and returns a full BillingCycleRunResponse with preview.
    - dry_run=False → enqueues the run via RabbitMQ and returns {job_id, status: queued}.
    """
    if req.dry_run:
        # Dry run stays synchronous — caller needs the preview data immediately.
        run = await billing_service.generate_invoices_for_month(
            org_id=current_user.org_id,
            billing_month=req.billing_month,
            sandbox=req.sandbox,
            dry_run=True,
            triggered_by=current_user.user_id,
        )
        return _run_to_response(run)

    # Non-dry-run: create a JobRun record then publish to the billing.runs queue.
    job = await job_run_repository.create(
        job_type="billing_run",
        payload={
            "org_id": current_user.org_id,
            "billing_month": req.billing_month,
            "sandbox": req.sandbox,
            "dry_run": False,
            "triggered_by": current_user.user_id,
        },
        org_id=current_user.org_id,
    )
    job_id = str(job.id)
    await publish(
        queue_name=_QUEUE_BILLING_RUNS,
        payload={
            "event_id": job_id,
            "org_id": current_user.org_id,
            "user_id": current_user.user_id,
            "billing_month": req.billing_month,
            "sandbox": req.sandbox,
            "dry_run": False,
            "job_id": job_id,
            "timestamp": utc_now().isoformat(),
        },
        correlation_id=job_id,
    )
    return BillingRunTriggerResponse(
        job_id=job_id,
        status="queued",
        billing_month=req.billing_month,
    )


@router.get(
    "/billing-runs",
    response_model=BillingCycleRunListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_billing_runs(
    billing_month: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> BillingCycleRunListResponse:
    return await invoice_service.list_billing_runs(
        current_user, billing_month=billing_month, page=page, page_size=page_size
    )


@router.get(
    "/billing-runs/{run_id}",
    response_model=BillingCycleRunResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_billing_run(
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> BillingCycleRunResponse:
    return await invoice_service.get_billing_run(run_id, current_user)


@router.get(
    "/counts",
    response_model=InvoiceCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_invoice_counts(
    billing_month: Optional[str] = Query(None),
    sandbox: Optional[bool] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceCountsResponse:
    return await invoice_service.get_counts(
        current_user, billing_month=billing_month, sandbox=sandbox
    )


@router.get(
    "",
    response_model=InvoiceListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def list_invoices(
    billing_month: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    lease_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sandbox: Optional[bool] = Query(None),
    invoice_category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceListResponse:
    return await invoice_service.list_invoices(
        current_user,
        billing_month=billing_month,
        property_id=property_id,
        tenant_id=tenant_id,
        lease_id=lease_id,
        status=status,
        sandbox=sandbox,
        invoice_category=invoice_category,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{invoice_id}",
    response_model=InvoiceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_invoice(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceResponse:
    return await invoice_service.get_invoice(invoice_id, current_user)


@router.get(
    "/{invoice_id}/pdf",
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def download_invoice_pdf(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    pdf_bytes = await invoice_service.generate_invoice_pdf_download(invoice_id, current_user)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice_{invoice_id}.pdf"'},
    )


@router.get(
    "/{invoice_id}/pdf-url",
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_invoice_pdf_url(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return a presigned S3 URL for the invoice PDF.

    Generates and caches the PDF to S3 on first call; subsequent calls return
    a fresh presigned URL without regenerating the PDF.
    """
    from app.core.s3 import generate_presigned_url
    from app.repositories.invoice_repository import invoice_repository

    invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)
    if not invoice:
        from app.core.exceptions import ResourceNotFoundError
        raise ResourceNotFoundError("Invoice", invoice_id)

    # Ensure PDF is cached in S3 (generates if not yet cached)
    if not invoice.pdf_key:
        await invoice_service.generate_invoice_pdf_download(invoice_id, current_user)
        invoice = await invoice_repository.get_by_id(invoice_id, current_user.org_id)

    if not invoice or not invoice.pdf_key:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="Invoice PDF could not be generated")

    url = await generate_presigned_url(invoice.pdf_key, expires=3600)
    return {"url": url, "reference_no": invoice.reference_no}


@router.patch(
    "/{invoice_id}",
    response_model=InvoiceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_invoice(
    invoice_id: str,
    req: InvoiceUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceResponse:
    return await invoice_service.update_invoice(invoice_id, req, current_user)


@router.post(
    "/{invoice_id}/send",
    response_model=InvoiceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_invoice(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceResponse:
    return await invoice_service.send_invoice(invoice_id, current_user)


@router.delete(
    "/{invoice_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def void_invoice(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await invoice_service.void_invoice(invoice_id, current_user)


@router.post(
    "/{invoice_id}/payments",
    response_model=InvoiceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def record_payment(
    invoice_id: str,
    req: InvoicePaymentRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InvoiceResponse:
    return await invoice_service.record_invoice_payment(invoice_id, req, current_user)


@router.get(
    "/{invoice_id}/payments",
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def list_invoice_payments(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    # Verify access
    await invoice_service.get_invoice(invoice_id, current_user)
    payments = await payment_repository.list_by_invoice(invoice_id, current_user.org_id)
    return {"items": [p.model_dump() for p in payments], "total": len(payments)}


@router.post(
    "/{invoice_id}/send-proforma",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_proforma(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Mark invoice as proforma and send to tenant for review before finalising."""
    await invoice_service.send_proforma(invoice_id, current_user)


@router.post(
    "/{invoice_id}/apply-smart-meter",
    response_model=Dict[str, Any],
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def apply_smart_meter_to_invoice(
    invoice_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Pull the latest IoT meter readings for the invoice's unit and:
    1. Apply current_reading to the water line item
    2. Attach last 30 days of readings as smart_meter_summary on the invoice
    3. Generate trend + advice text
    """
    from fastapi import HTTPException
    from app.models.invoice import Invoice
    from app.models.unit import Unit
    from app.models.meter_reading import MeterReading
    from beanie import PydanticObjectId as OID
    from app.services.billing_service import apply_meter_reading_to_invoice
    import statistics
    from datetime import timedelta

    inv = await Invoice.find_one({"_id": OID(invoice_id), "org_id": current_user.org_id, "deleted_at": None})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    unit = await Unit.find_one({"_id": OID(inv.unit_id), "org_id": current_user.org_id, "deleted_at": None}) if inv.unit_id else None
    if not unit:
        raise HTTPException(status_code=400, detail="Invoice has no linked unit")

    # Fetch last 30 days of IoT water readings
    since = utc_now() - timedelta(days=30)
    readings = await MeterReading.find(
        {
            "org_id": current_user.org_id,
            "unit_id": inv.unit_id,
            "utility_key": "water",
            "read_at": {"$gte": since},
            "deleted_at": None,
        }
    ).sort("-read_at").to_list(200)

    if not readings:
        raise HTTPException(status_code=400, detail="No IoT water readings found for this unit in the last 30 days. Seed readings first.")

    # Latest reading value
    latest = readings[0]
    first = readings[-1]

    # Find water line item
    water_li = next((li for li in (inv.line_items or []) if li.utility_key == "water"), None)

    # Apply the latest reading to the invoice water line item
    if water_li and water_li.status == "pending":
        inv = await apply_meter_reading_to_invoice(
            invoice_id=invoice_id,
            line_item_id=water_li.id,
            current_reading=latest.current_reading,
            org_id=current_user.org_id,
            previous_reading=first.previous_reading,
        )

    # Build smart meter summary
    daily_usage: dict = {}
    for r in readings:
        day_key = r.read_at.strftime("%Y-%m-%d")
        daily_usage[day_key] = daily_usage.get(day_key, 0) + (r.units_consumed or 0)

    day_values = list(daily_usage.values())
    total_consumed = round(sum(day_values), 2)
    avg_daily = round(statistics.mean(day_values), 2) if day_values else 0
    peak_day = max(daily_usage, key=lambda k: daily_usage[k]) if daily_usage else None
    peak_val = round(daily_usage[peak_day], 2) if peak_day else 0

    # Trend: compare first half vs second half
    mid = len(day_values) // 2
    first_half_avg = statistics.mean(day_values[:mid]) if day_values[:mid] else 0
    second_half_avg = statistics.mean(day_values[mid:]) if day_values[mid:] else 0
    trend_pct = round(((second_half_avg - first_half_avg) / first_half_avg * 100) if first_half_avg > 0 else 0, 1)

    # Generate advice
    advice = []
    if trend_pct > 20:
        advice.append(f"Warning: Usage trending UP {trend_pct}% vs first half of month. Check for leaks or unusual consumption.")
    elif trend_pct > 10:
        advice.append(f"Moderate usage increase ({trend_pct}%) detected. Monitor closely.")
    elif trend_pct < -15:
        advice.append(f"Usage decreased {abs(trend_pct)}% this month. Conservation efforts are working.")

    if avg_daily > 300:
        advice.append("Daily average exceeds 300L. Consider water-saving fixtures.")
    elif avg_daily < 50:
        advice.append("Very low consumption detected. Verify meter is functioning correctly.")

    if peak_val > avg_daily * 2.5:
        advice.append(f"Peak usage on {peak_day} was {peak_val}L — {round(peak_val/avg_daily,1)}x the daily average.")

    if not advice:
        advice.append("Usage is within normal range for this billing period.")

    smart_summary = {
        "unit_id": inv.unit_id if hasattr(inv, "unit_id") else str(unit.id),
        "utility_key": "water",
        "reading_count": len(readings),
        "total_usage": total_consumed,
        "avg_daily_usage": avg_daily,
        "peak_day": peak_day or "",
        "peak_usage": peak_val,
        "trend_pct": trend_pct,
        "trend_direction": "up" if trend_pct > 5 else "down" if trend_pct < -5 else "stable",
        "advice": advice,
        "daily_breakdown": [
            {"date": k, "readings": 1, "total_usage": round(v, 2), "avg_usage": round(v, 2)}
            for k, v in sorted(daily_usage.items())
        ],
        "latest_reading": latest.current_reading,
        "previous_reading": first.previous_reading or first.current_reading,
        "applied_at": utc_now().isoformat(),
    }

    # Persist smart_meter_summary on the invoice
    await Invoice.find_one({"_id": OID(invoice_id)}).update(
        {"$set": {"smart_meter_summary": smart_summary, "updated_at": utc_now()}}
    )

    # Return using the service so PydanticObjectId / enriched fields are handled correctly
    refreshed = await invoice_service.get_invoice(invoice_id, current_user)
    return {"invoice": refreshed.model_dump(), "smart_meter_summary": smart_summary}
