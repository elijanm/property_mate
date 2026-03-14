"""
Late fee service — scans overdue invoices and applies late fees.
Called by the billing worker on a daily schedule.
"""
from datetime import date
from typing import Optional

import structlog

from app.models.invoice import Invoice, InvoiceLineItem
from app.repositories.property_repository import property_repository
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def apply_late_fees_for_org(org_id: str) -> dict:
    """
    Scan all overdue invoices for org and apply late fees per property setting.
    Returns summary: {applied: int, skipped: int, total_amount: float}
    """
    today = date.today()
    overdue_invoices = await Invoice.find(
        Invoice.org_id == org_id,
        Invoice.status == "overdue",
        Invoice.deleted_at == None,  # noqa: E711
    ).to_list()

    applied = 0
    skipped = 0
    total_amount = 0.0

    for inv in overdue_invoices:
        try:
            prop = await property_repository.get_by_id(inv.property_id, org_id)
            if not prop or not prop.late_fee_setting or not prop.late_fee_setting.enabled:
                skipped += 1
                continue

            lfs = prop.late_fee_setting
            # Check grace period
            days_overdue = (today - inv.due_date).days if inv.due_date else 0
            if days_overdue < lfs.grace_days:
                skipped += 1
                continue

            # Check max applications
            if lfs.max_applications > 0 and (inv.late_fees_applied or 0) >= lfs.max_applications:
                skipped += 1
                continue

            # Compute fee amount
            if lfs.fee_type == "percentage":
                fee_amount = round(inv.balance_due * lfs.fee_value / 100, 2)
            else:
                fee_amount = lfs.fee_value

            if fee_amount <= 0:
                skipped += 1
                continue

            # Add late fee line item
            late_fee_item = InvoiceLineItem(
                type="late_fee",
                description=f"Late payment fee ({days_overdue} days overdue)",
                quantity=1,
                unit_price=fee_amount,
                amount=fee_amount,
                status="confirmed",
            )
            inv.line_items = (inv.line_items or []) + [late_fee_item]
            inv.total_amount = round(inv.total_amount + fee_amount, 2)
            inv.balance_due = round(inv.balance_due + fee_amount, 2)
            inv.late_fees_applied = (inv.late_fees_applied or 0) + 1
            inv.late_fee_amount = round((inv.late_fee_amount or 0.0) + fee_amount, 2)
            inv.updated_at = utc_now()
            await inv.save()

            applied += 1
            total_amount += fee_amount
            logger.info(
                "late_fee_applied",
                invoice_id=str(inv.id),
                org_id=org_id,
                fee_amount=fee_amount,
                days_overdue=days_overdue,
                action="apply_late_fee",
                resource_type="invoice",
                resource_id=str(inv.id),
                status="success",
            )

        except Exception as exc:
            logger.error(
                "late_fee_error",
                invoice_id=str(inv.id),
                org_id=org_id,
                error=str(exc),
                action="apply_late_fee",
                resource_type="invoice",
                resource_id=str(inv.id),
                status="error",
            )
            skipped += 1

    return {"applied": applied, "skipped": skipped, "total_amount": total_amount}
