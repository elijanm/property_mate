"""
Payment service — records payments, initiates Mpesa STK/B2C, updates ledger,
and auto-activates leases when full deposit is paid.
"""
import asyncio
import calendar
import secrets
from datetime import timedelta
from typing import Any, Dict, List

import structlog

from app.core.email import (
    send_email, _base,
    payment_confirmation_html, lease_signing_invite_html, welcome_move_in_html,
)
from app.core.config import settings
from app.core.exceptions import ConflictError, ResourceNotFoundError, ValidationError
from app.core.rabbitmq import publish
from app.dependencies.auth import CurrentUser
from app.models.inspection_report import InspectionReport
from app.models.ledger_entry import LedgerEntry
from app.models.payment import Payment
from app.repositories.inspection_repository import inspection_repository
from app.repositories.invoice_repository import invoice_repository
from app.repositories.lease_repository import lease_repository
from app.repositories.ledger_repository import ledger_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.property_repository import property_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.onboarding_repository import onboarding_repository
from app.repositories.user_repository import user_repository
from app.schemas.payment import (
    LedgerEntryResponse,
    PaymentCreateRequest,
    PaymentResponse,
    PaymentSummary,
    RefundRequest,
)
from app.utils.datetime import utc_now
from app.utils.mpesa import stk_push, b2c_payment

logger = structlog.get_logger(__name__)


def compute_deposit_interest(
    deposit_amount: float,
    lease_start,
    rate_pct: float,
    compound: bool = False,
) -> float:
    """Compute interest accrued on security deposit from lease_start to today."""
    from datetime import date as _d
    today = _d.today()
    if isinstance(lease_start, str):
        lease_start = _d.fromisoformat(lease_start)
    days = max(0, (today - lease_start).days)
    years = days / 365.25
    if compound:
        interest = deposit_amount * ((1 + rate_pct / 100) ** years - 1)
    else:
        interest = deposit_amount * (rate_pct / 100) * years
    return round(interest, 2)


# ── Private helpers ──────────────────────────────────────────────────────────

def _payment_to_response(p: Payment) -> PaymentResponse:
    return PaymentResponse(
        id=str(p.id),
        org_id=p.org_id,
        lease_id=p.lease_id,
        property_id=p.property_id,
        unit_id=p.unit_id,
        tenant_id=p.tenant_id,
        category=p.category,
        method=p.method,
        direction=p.direction,
        amount=p.amount,
        currency=p.currency,
        status=p.status,
        mpesa_checkout_request_id=p.mpesa_checkout_request_id,
        mpesa_receipt_no=p.mpesa_receipt_no,
        mpesa_phone=p.mpesa_phone,
        notes=p.notes,
        recorded_by=p.recorded_by,
        payment_date=p.payment_date,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


async def _append_ledger(
    payment: Payment,
    description: str,
    is_outbound: bool = False,
) -> None:
    """Append a credit (inbound) or debit (outbound) ledger entry."""
    last_balance = await ledger_repository.last_balance(payment.lease_id, payment.org_id)
    if is_outbound:
        running_balance = last_balance - payment.amount
        entry_type = "debit"
    else:
        running_balance = last_balance + payment.amount
        entry_type = "credit"

    entry = LedgerEntry(
        org_id=payment.org_id,
        lease_id=payment.lease_id,
        property_id=payment.property_id,
        tenant_id=payment.tenant_id,
        payment_id=str(payment.id),
        type=entry_type,
        category=payment.category,
        amount=payment.amount,
        description=description,
        running_balance=running_balance,
    )
    await ledger_repository.create(entry)


def _compute_required(lease) -> float:
    """Total move-in amount: deposit + utility_deposit + pro-rated rent for move-in month."""
    dim = calendar.monthrange(lease.start_date.year, lease.start_date.month)[1]
    remaining_days = dim - lease.start_date.day + 1
    prorated = round((remaining_days / dim) * lease.rent_amount, 2)
    return round(lease.deposit_amount + (lease.utility_deposit or 0.0) + prorated, 2)


async def _process_payment_transition(lease_id: str, org_id: str) -> None:
    """
    After every successful payment:
    - Partial payment  → lease: pending_payment, unit: booked, email confirmation
    - Full payment     → lease: pending_signature, unit: booked, email signing invite
    Activation (→ active + occupied) happens only when the tenant signs the lease.
    """
    lease = await lease_repository.get_by_id(lease_id, org_id)
    if not lease or lease.status in ("active", "terminated", "expired"):
        return

    payments = await payment_repository.list_by_lease(lease_id, org_id)
    total_paid = sum(
        p.amount for p in payments
        if p.status == "completed" and p.direction == "inbound"
    )
    if total_paid <= 0:
        return

    required = _compute_required(lease)
    tenant = await user_repository.get_by_id(lease.tenant_id)
    portal_url = f"{settings.app_base_url}/tenant/lease"
    tenant_name = tenant.first_name if tenant else "Tenant"

    # Move unit to booked (from any pre-occupied status)
    if lease.status in ("draft", "pending_payment"):
        for from_status in ("reserved", "vacant", "booked"):
            unit = await unit_repository.atomic_status_transition(
                unit_id=lease.unit_id, org_id=org_id,
                expected_status=from_status, new_status="booked",
            )
            if unit:
                break

    if total_paid >= required:
        # ── Full payment received ──────────────────────────────────────────
        if lease.signed_at:
            # Already signed before payment cleared — activate immediately
            if lease.status not in ("active", "terminated", "expired"):
                unit = None
                for from_status in ("booked", "reserved", "vacant"):
                    unit = await unit_repository.atomic_status_transition(
                        unit_id=lease.unit_id, org_id=org_id,
                        expected_status=from_status, new_status="occupied",
                    )
                    if unit:
                        break

                lease.status = "active"
                lease.activated_at = utc_now()
                lease.updated_at = utc_now()
                await lease_repository.save(lease)

                if lease.onboarding_id:
                    ob = await onboarding_repository.get_by_id(lease.onboarding_id, org_id)
                    if ob:
                        ob.status = "activated"
                        await onboarding_repository.save(ob)

                await publish("pms.events", {
                    "org_id": org_id, "action": "lease_activated",
                    "lease_id": lease_id, "unit_id": lease.unit_id,
                    "tenant_id": lease.tenant_id, "property_id": lease.property_id,
                })

                # Create pre-move-in inspection
                window_days = 15
                prop = None
                try:
                    prop = await property_repository.get_by_id(lease.property_id, org_id)
                    if prop and prop.unit_policies:
                        window_days = prop.unit_policies.move_in_inspection_days
                except Exception:
                    pass

                token = secrets.token_urlsafe(32)
                expires_at = utc_now() + timedelta(days=window_days)
                report = InspectionReport(
                    org_id=org_id,
                    lease_id=lease_id,
                    property_id=lease.property_id,
                    unit_id=lease.unit_id,
                    tenant_id=lease.tenant_id,
                    type="pre_move_in",
                    token=token,
                    expires_at=expires_at,
                    window_days=window_days,
                )
                _, _tenant = await asyncio.gather(
                    inspection_repository.create(report),
                    user_repository.get_by_id(lease.tenant_id),
                )
                if _tenant and _tenant.email:
                    prop_name = prop.name if prop else "your property"
                    inspection_url = f"{settings.app_base_url}/inspection/{token}"
                    await send_email(
                        to=str(_tenant.email),
                        subject="Welcome! Complete your move-in inspection",
                        html=welcome_move_in_html(
                            _tenant.first_name or "Tenant",
                            prop_name,
                            inspection_url,
                            window_days,
                        ),
                    )

                logger.info(
                    "lease_activated_on_full_payment",
                    action="_process_payment_transition",
                    resource_type="lease", resource_id=lease_id,
                    org_id=org_id, status="success",
                )
        else:
            # Not yet signed — ask tenant to sign
            if lease.status in ("draft", "pending_payment"):
                lease.status = "pending_signature"
                lease.updated_at = utc_now()
                await lease_repository.save(lease)
                logger.info(
                    "lease_pending_signature",
                    action="_process_payment_transition",
                    resource_type="lease", resource_id=lease_id,
                    org_id=org_id, status="success",
                )

            if tenant and tenant.email:
                await send_email(
                    to=str(tenant.email),
                    subject=f"Sign your lease — {lease.reference_no}",
                    html=lease_signing_invite_html(tenant_name, lease.reference_no, portal_url),
                )
    else:
        # ── Partial payment received ───────────────────────────────────────
        if lease.status == "draft":
            lease.status = "pending_payment"
            lease.updated_at = utc_now()
            await lease_repository.save(lease)

        remaining = round(required - total_paid, 2)
        if tenant and tenant.email:
            await send_email(
                to=str(tenant.email),
                subject=f"Payment received — KES {remaining:,.0f} remaining",
                html=payment_confirmation_html(
                    tenant_name, lease.reference_no, total_paid, remaining, portal_url
                ),
            )


def _inspection_invite_html(inspection_url: str) -> str:
    body = f"""
<h2>Your unit is ready!</h2>
<p>Congratulations — your lease is now active.</p>
<p>Please complete your <strong>pre-move-in inspection</strong> before moving in.
This records the condition of the unit and protects both you and the landlord.</p>
<a href="{inspection_url}" class="btn">Start Inspection →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{inspection_url}" style="color:#1d4ed8;">{inspection_url}</a>
</p>"""
    return _base("Pre-Move-In Inspection", body)


# ── Public API ───────────────────────────────────────────────────────────────

async def record_payment(
    lease_id: str,
    request: PaymentCreateRequest,
    current_user: CurrentUser,
) -> PaymentResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    if request.method == "mpesa_stk" and not request.mpesa_phone:
        raise ValidationError("mpesa_phone is required for mpesa_stk method")

    payment = Payment(
        org_id=current_user.org_id,
        lease_id=str(lease_id),
        property_id=str(lease.property_id),
        unit_id=lease.unit_id,
        tenant_id=lease.tenant_id,
        category=request.category,
        method=request.method,
        direction="inbound",
        amount=request.amount,
        payment_date=request.payment_date,
        mpesa_phone=request.mpesa_phone,
        notes=request.notes,
        recorded_by=current_user.user_id,
        status="pending",
    )

    if request.method == "mpesa_stk":
        try:
            stk_resp = await stk_push(
                phone=request.mpesa_phone,  # type: ignore[arg-type]
                amount=request.amount,
                account_ref=lease.reference_no,
                description=f"{request.category.replace('_', ' ').title()} payment",
            )
            payment.mpesa_checkout_request_id = stk_resp.get("CheckoutRequestID")
            await payment_repository.create(payment)
        except Exception as exc:
            logger.error(
                "mpesa_stk_push_failed",
                action="record_payment",
                lease_id=lease_id,
                org_id=current_user.org_id,
                error=str(exc),
                status="error",
            )
            raise ValidationError(f"Mpesa STK push failed: {exc}") from exc
    else:
        payment.status = "completed"
        await payment_repository.create(payment)
        await _append_ledger(
            payment,
            description=f"{request.category.replace('_', ' ').title()} received via {request.method}",
        )
        await _process_payment_transition(lease_id, current_user.org_id)

    logger.info(
        "payment_recorded",
        action="record_payment",
        resource_type="payment",
        resource_id=payment.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _payment_to_response(payment)


async def handle_stk_callback(body: Dict[str, Any]) -> None:
    """
    Process Daraja STK push callback.
    Body shape:
      {"Body": {"stkCallback": {"CheckoutRequestID": ..., "ResultCode": ...,
                                "CallbackMetadata": {"Item": [...]}}}}
    """
    stk = body.get("Body", {}).get("stkCallback", {})
    checkout_id = stk.get("CheckoutRequestID")
    result_code = stk.get("ResultCode")

    if not checkout_id:
        logger.warning("stk_callback_missing_checkout_id", body=body)
        return

    payment = await payment_repository.get_by_checkout_request_id(checkout_id)
    if not payment:
        logger.warning("stk_callback_payment_not_found", checkout_request_id=checkout_id)
        return

    if result_code == 0:
        # Extract receipt number from metadata
        receipt_no = None
        for item in stk.get("CallbackMetadata", {}).get("Item", []):
            if item.get("Name") == "MpesaReceiptNumber":
                receipt_no = item.get("Value")
                break

        payment.status = "completed"
        payment.mpesa_receipt_no = receipt_no
        await payment_repository.save(payment)

        await _append_ledger(
            payment,
            description=f"{payment.category.replace('_', ' ').title()} via Mpesa STK (ref: {receipt_no})",
        )
        await _process_payment_transition(payment.lease_id, payment.org_id)
    else:
        payment.status = "failed"
        await payment_repository.save(payment)

    logger.info(
        "stk_callback_processed",
        action="handle_stk_callback",
        checkout_request_id=checkout_id,
        result_code=result_code,
        status="success",
    )


async def initiate_refund(
    lease_id: str,
    request: RefundRequest,
    current_user: CurrentUser,
) -> PaymentResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    # Compute deposit collected
    payments = await payment_repository.list_by_lease(lease_id, current_user.org_id)
    deposit_held = sum(
        p.amount for p in payments
        if p.status == "completed"
        and p.direction == "inbound"
        and p.category in ("deposit", "utility_deposit")
    )

    # Compute total deductions
    from app.repositories.deduction_repository import deduction_repository
    deductions = await deduction_repository.list_by_lease(lease_id, current_user.org_id)
    total_deductions = sum(d.amount for d in deductions)

    net_refund = max(0.0, deposit_held - total_deductions)
    if net_refund <= 0:
        raise ValidationError("No refund amount available after deductions")

    if request.method == "mpesa_b2c" and not request.mpesa_phone:
        raise ValidationError("mpesa_phone is required for mpesa_b2c method")

    payment = Payment(
        org_id=current_user.org_id,
        lease_id=lease_id,
        property_id=lease.property_id,
        unit_id=lease.unit_id,
        tenant_id=lease.tenant_id,
        category="refund",
        method=request.method,
        direction="outbound",
        amount=net_refund,
        payment_date=utc_now().date(),
        mpesa_phone=request.mpesa_phone,
        notes=request.notes,
        recorded_by=current_user.user_id,
        status="pending",
    )

    if request.method == "mpesa_b2c":
        try:
            b2c_resp = await b2c_payment(
                phone=request.mpesa_phone,  # type: ignore[arg-type]
                amount=net_refund,
                remarks=f"Deposit refund for lease {lease.reference_no}",
            )
            payment.mpesa_checkout_request_id = b2c_resp.get("ConversationID")
            await payment_repository.create(payment)
        except Exception as exc:
            logger.error(
                "mpesa_b2c_failed",
                action="initiate_refund",
                lease_id=lease_id,
                org_id=current_user.org_id,
                error=str(exc),
                status="error",
            )
            raise ValidationError(f"Mpesa B2C payment failed: {exc}") from exc
    else:
        payment.status = "completed"
        await payment_repository.create(payment)
        await _append_ledger(payment, description=f"Deposit refund via {request.method}", is_outbound=True)

    logger.info(
        "refund_initiated",
        action="initiate_refund",
        resource_type="payment",
        resource_id=payment.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _payment_to_response(payment)


async def list_payments(lease_id: str, current_user: CurrentUser) -> PaymentSummary:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    all_payments = await payment_repository.list_by_lease(lease_id, current_user.org_id)

    # Separate direct lease payments (deposit, advance rent) from invoice-settlement
    # payments.  Invoice payments are tracked by the invoicing system and must NOT
    # pollute the move-in deposit / arrears calculation.
    direct_payments = [p for p in all_payments if not p.invoice_id]

    completed_inbound = [
        p for p in direct_payments if p.status == "completed" and p.direction == "inbound"
    ]
    completed_outbound = [
        p for p in direct_payments if p.status == "completed" and p.direction == "outbound"
    ]

    total_paid = sum(p.amount for p in completed_inbound)
    total_refunded = sum(p.amount for p in completed_outbound)
    deposit_required = _compute_required(lease)

    # deposit_paid: only direct deposit / utility-deposit payments count toward the
    # move-in requirement.  Rent or utility payments via invoice are excluded.
    deposit_paid = sum(
        p.amount for p in completed_inbound
        if p.category in ("deposit", "utility_deposit")
    )

    dim = calendar.monthrange(lease.start_date.year, lease.start_date.month)[1]
    remaining_days = dim - lease.start_date.day + 1
    prorated_rent = round((remaining_days / dim) * lease.rent_amount, 2)

    # Prepayment credit = direct deposit payments beyond the move-in requirement
    prepayment_credit = max(0.0, deposit_paid - deposit_required)

    # Outstanding invoice balance — used by the frontend for rent-arrears display
    outstanding_invoices = await invoice_repository.list_outstanding_for_lease(
        lease_id=lease_id, org_id=current_user.org_id
    )
    outstanding_balance = round(sum(inv.balance_due for inv in outstanding_invoices), 2)

    return PaymentSummary(
        payments=[_payment_to_response(p) for p in direct_payments],
        total_paid=total_paid,
        total_refunded=total_refunded,
        balance=total_paid - total_refunded,
        deposit_paid=deposit_paid,
        deposit_required=deposit_required,
        prorated_rent=prorated_rent,
        prorated_days=remaining_days,
        days_in_month=dim,
        fully_paid=deposit_paid >= deposit_required,
        prepayment_credit=prepayment_credit,
        outstanding_balance=outstanding_balance,
    )


async def initiate_onboarding_payment(
    ob,
    phone: str,
    amount: float,
    sandbox: bool = False,
) -> Payment:
    """
    Initiate a move-in payment from the public onboarding wizard (no CurrentUser).
    In sandbox mode the payment is instantly marked completed.
    """
    if not ob.lease_id:
        raise ValidationError("Onboarding has no linked lease")

    lease = await lease_repository.get_by_id(ob.lease_id, ob.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", ob.lease_id)

    # Resolve the Mpesa account reference from property payment_config
    account_ref = lease.reference_no or "RENT"
    try:
        prop = await property_repository.get_by_id(ob.property_id, ob.org_id)
        if prop and prop.payment_config:
            pc = prop.payment_config
            if pc.account_reference_type == "unit_code":
                from app.repositories.unit_repository import unit_repository
                unit = await unit_repository.get_by_id(lease.unit_id, ob.org_id)
                account_ref = unit.unit_code if unit else account_ref
            elif pc.account_reference_type == "tenant_id":
                account_ref = str(ob.tenant_id or lease.tenant_id)
            elif pc.account_reference_type == "custom" and pc.custom_account_reference:
                account_ref = pc.custom_account_reference
    except Exception:
        pass

    payment = Payment(
        org_id=ob.org_id,
        lease_id=str(ob.lease_id),
        property_id=ob.property_id,
        unit_id=lease.unit_id,
        tenant_id=lease.tenant_id,
        category="deposit",
        method="sandbox" if sandbox else "mpesa_stk",
        direction="inbound",
        amount=amount,
        payment_date=utc_now().date(),
        mpesa_phone=phone,
        notes="Move-in payment via onboarding wizard",
        status="pending",
    )

    if sandbox:
        payment.status = "completed"
        await payment_repository.create(payment)
        await _append_ledger(payment, description="Move-in payment (sandbox)")
        await _process_payment_transition(str(ob.lease_id), ob.org_id)
    else:
        try:
            stk_resp = await stk_push(
                phone=phone,
                amount=amount,
                account_ref=account_ref,
                description="Move-in payment",
            )
            payment.mpesa_checkout_request_id = stk_resp.get("CheckoutRequestID")
        except Exception as exc:
            logger.error(
                "onboarding_stk_push_failed",
                action="initiate_onboarding_payment",
                org_id=ob.org_id, error=str(exc), status="error",
            )
            raise ValidationError(f"Mpesa STK push failed: {exc}") from exc
        await payment_repository.create(payment)

    logger.info(
        "onboarding_payment_initiated",
        action="initiate_onboarding_payment",
        resource_type="payment", resource_id=str(payment.id),
        org_id=ob.org_id, status="success",
    )
    return payment


async def get_ledger(lease_id: str, current_user: CurrentUser) -> List[LedgerEntryResponse]:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    entries = await ledger_repository.list_by_lease(lease_id, current_user.org_id)
    return [
        LedgerEntryResponse(
            id=str(e.id),
            org_id=e.org_id,
            lease_id=e.lease_id,
            property_id=e.property_id,
            tenant_id=e.tenant_id,
            payment_id=e.payment_id,
            type=e.type,
            category=e.category,
            amount=e.amount,
            description=e.description,
            running_balance=e.running_balance,
            created_at=e.created_at,
        )
        for e in entries
    ]


async def trigger_voice_stk(request: dict, current_user: CurrentUser) -> dict:
    """Initiate an STK push during a voice call. Used by the voice agent service."""
    from app.repositories.user_repository import user_repository as _ur
    from app.repositories.tenant_repository import tenant_repository as _tr

    tenant_id = request.get("tenant_id", "")
    invoice_id = request.get("invoice_id", "")
    amount = float(request.get("amount", 0))

    if amount <= 0:
        raise ValidationError("INVALID_AMOUNT", "Amount must be greater than zero")

    # Look up tenant phone
    tenant = await _tr.get_by_id(tenant_id, current_user.org_id) if current_user.org_id else None
    if not tenant:
        # superadmin token — try fetching without org filter using raw motor
        from app.core.database import get_db as _get_db
        from beanie import PydanticObjectId
        from app.models.tenant import Tenant
        try:
            db = _get_db()
            doc = await Tenant.get(PydanticObjectId(tenant_id))
            tenant = doc
        except Exception:
            pass

    if not tenant:
        raise ResourceNotFoundError("TENANT_NOT_FOUND", "Tenant not found")

    phone = getattr(tenant, "phone", None)
    if not phone:
        raise ValidationError("NO_PHONE", "Tenant has no phone number on file")

    account_ref = invoice_id[:12] if invoice_id else f"TEN{tenant_id[:8]}"
    description = f"Rent payment - {account_ref}"

    try:
        result = await stk_push(phone, amount, account_ref, description)
    except Exception as exc:
        logger.error("voice_stk_push_failed", tenant_id=tenant_id, error=str(exc))
        raise ValidationError("STK_FAILED", f"STK push failed: {exc}")

    checkout_id = result.get("CheckoutRequestID", "")
    response_code = result.get("ResponseCode", "1")
    if response_code != "0":
        raise ValidationError("STK_FAILED", result.get("ResponseDescription", "STK push rejected"))

    return {
        "initiated": True,
        "checkout_request_id": checkout_id,
        "customer_message": result.get("CustomerMessage", "Check your phone for the M-Pesa prompt"),
    }


async def get_stk_status(checkout_request_id: str, current_user: CurrentUser) -> dict:
    """Return the status of a pending STK push."""
    payment = await payment_repository.get_by_checkout_request_id(checkout_request_id)
    if not payment:
        return {
            "status": "pending",
            "paid": False,
            "message": "Payment not yet confirmed — please wait a moment.",
        }
    if payment.status == "completed":
        return {
            "status": "completed",
            "paid": True,
            "amount": payment.amount,
            "receipt": payment.mpesa_receipt_no,
            "message": f"Payment of KSh {payment.amount:,.0f} confirmed. Receipt: {payment.mpesa_receipt_no}",
        }
    return {
        "status": payment.status,
        "paid": False,
        "message": f"Payment status: {payment.status}",
    }
