"""
Lease service — creation, activation, termination.
Activation uses atomic unit status update + Redis lock for concurrency safety.
"""
import asyncio
import secrets
from datetime import timedelta
from typing import Optional

import structlog
from beanie import PydanticObjectId
from redis.asyncio import Redis

from app.core.config import settings
from app.core.email import send_email, lease_created_tenant_html, welcome_move_in_html
from app.core.exceptions import ConflictError, ResourceNotFoundError, ValidationError
from app.core.metrics import UNIT_ASSIGNMENTS
from app.core.rabbitmq import publish
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import PaginationParams
from app.models.inspection_report import InspectionReport
from app.models.lease import Lease
from app.models.onboarding import Onboarding
from app.models.user import User
from app.repositories.audit_log_repository import audit_log_repository
from app.repositories.inspection_repository import inspection_repository
from app.repositories.lease_repository import lease_repository
from app.repositories.ledger_repository import ledger_repository
from app.repositories.onboarding_repository import onboarding_repository
from app.repositories.org_repository import org_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.property_repository import property_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.schemas.lease import (
    LeaseCreateRequest, LeaseDiscountCreateRequest, LeaseListResponse, LeaseResponse,
    RentEscalationCreateRequest, EarlyTerminationTermsRequest,
    RenewalOfferCreateRequest, CoTenantCreateRequest, LeaseNoteCreateRequest, TenantRatingRequest,
)
from app.services.auth_service import hash_password
from app.services.payment_service import _compute_required
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def create_lease(
    property_id: str,
    request: LeaseCreateRequest,
    current_user: CurrentUser,
) -> LeaseResponse:
   
    # Validate: need exactly one of tenant_id or tenant_create
    if not request.tenant_id and not request.tenant_create:
        raise ValidationError("Provide either tenant_id or tenant_create")
    if request.tenant_id and request.tenant_create:
        raise ValidationError("Provide only one of tenant_id or tenant_create")

    # Verify property belongs to org
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    
    # property_id = PydanticObjectId(property_id)
    # Verify unit belongs to property
    unit = await unit_repository.get_by_id(request.unit_id, current_user.org_id)
    if not unit or unit.property_id != PydanticObjectId(property_id):
        raise ResourceNotFoundError("Unit", request.unit_id)

    if unit.status == "occupied":
        raise ConflictError("Unit already has an active lease")

    # Check for existing active lease on unit
    existing = await lease_repository.get_active_for_unit(request.unit_id, current_user.org_id)
    if existing:
        raise ConflictError("Unit already has an active lease")

    # Inline tenant creation
    tenant_id = request.tenant_id
    _new_tenant: Optional[User] = None
    if request.tenant_create:
        tc = request.tenant_create
        existing_user = await user_repository.get_by_email(str(tc.email))
        if existing_user:
            raise ConflictError(f"Email '{tc.email}' is already registered")
        new_tenant = User(
            email=tc.email,
            hashed_password=hash_password(tc.password),
            org_id=current_user.org_id,
            role="tenant",
            first_name=tc.first_name,
            last_name=tc.last_name,
            phone=tc.phone,
        )
        await user_repository.create(new_tenant)
        tenant_id = new_tenant.id
        _new_tenant = new_tenant

    lease = Lease(
        org_id=current_user.org_id,
        property_id=str(property_id),
        unit_id=str(request.unit_id),
        tenant_id=str(tenant_id),
        onboarding_id=request.onboarding_id,
        start_date=request.start_date,
        end_date=request.end_date,
        rent_amount=request.rent_amount,
        deposit_amount=request.deposit_amount,
        utility_deposit=request.utility_deposit,
        notes=request.notes,
        status="draft",
    )
    await lease_repository.create(lease)
    # `unit` already fetched above — reuse for response

    await audit_log_repository.create(
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        resource_type="lease",
        resource_id=lease.id,
        action="create",
        after={
            "unit_id": lease.unit_id,
            "tenant_id": lease.tenant_id,
            "start_date": str(lease.start_date),
            "rent_amount": lease.rent_amount,
            "utility_deposit": lease.utility_deposit,
        },
    )

    # Link existing onboarding OR auto-create one with invite token, then send invite email
    _onboarding_token: Optional[str] = None
    try:
        tenant_user = _new_tenant or await user_repository.get_by_id(str(tenant_id))

        if request.onboarding_id:  # type: ignore[truthy-bool]
            # Pre-created onboarding (e.g., from KYC wizard) — link and fetch token
            ob = await onboarding_repository.get_by_id(request.onboarding_id, current_user.org_id)
            if ob:
                ob.lease_id = lease.id
                ob.status = "contract_drafted"
                await onboarding_repository.save(ob)
                _onboarding_token = ob.invite_token
        else:
            # Auto-create onboarding with invite token and send invite email
            invite_token = secrets.token_urlsafe(32)
            onboarding = Onboarding(
                org_id=current_user.org_id,
                property_id=str(property_id),
                unit_id=str(request.unit_id),
                tenant_id=str(tenant_id),
                lease_id=str(lease.id),
                initiated_by=str(current_user.user_id),
                invite_token=invite_token,
                invite_email=str(tenant_user.email) if tenant_user and tenant_user.email else None,
                first_name=tenant_user.first_name if tenant_user else None,
                last_name=tenant_user.last_name if tenant_user else None,
                phone=tenant_user.phone if tenant_user else None,
                status="invited",
            )
            await onboarding_repository.create(onboarding)
            lease.onboarding_id = str(onboarding.id)
            await lease_repository.save(lease)
            _onboarding_token = invite_token

            if tenant_user and tenant_user.email:
                onboarding_url = f"{settings.app_base_url}/onboarding/{invite_token}"
                await send_email(
                    to=str(tenant_user.email),
                    subject=f"Complete your onboarding — {lease.reference_no}",
                    html=lease_created_tenant_html(
                        tenant_user.first_name or "Tenant",
                        lease.reference_no,
                        onboarding_url,
                    ),
                )
    except Exception as _exc:
        logger.warning("lease_created_onboarding_failed", lease_id=str(lease.id), exc_info=_exc)

    logger.info(
        "lease_created",
        action="create_lease",
        resource_type="lease",
        resource_id=str(lease.id),
        org_id=current_user.org_id,
        user_id=str(current_user.user_id),
        status="success",
    )
    return _to_response(lease, unit, _onboarding_token)


async def activate_lease(
    lease_id: str,
    current_user: CurrentUser,
    redis: Redis,
) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    if lease.status != "draft":
        raise ValidationError(f"Lease is already {lease.status}")

    # Acquire lock on unit before activating
    lock_key = f"lock:{current_user.org_id}:unit_assign:{lease.unit_id}"
    if not await redis.set(lock_key, "1", ex=30, nx=True):
        raise ConflictError("Unit is currently being processed — please retry shortly")

    try:
        # Atomically set unit to occupied (only if reserved or vacant)
        unit = await unit_repository.atomic_status_transition(
            unit_id=lease.unit_id,
            org_id=current_user.org_id,
            expected_status="reserved",
            new_status="occupied",
        )
        if unit is None:
            # Try from vacant (owner direct assignment without reservation step)
            unit = await unit_repository.atomic_status_transition(
                unit_id=lease.unit_id,
                org_id=current_user.org_id,
                expected_status="vacant",
                new_status="occupied",
            )
        if unit is None:
            raise ConflictError("Unit is not available for lease activation")

        # Activate lease
        lease.status = "active"
        lease.activated_at = utc_now()
        await lease_repository.save(lease)

        # Generate deposit invoice (best-effort — don't fail activation)
        try:
            from app.services.invoice_service import create_deposit_invoice
            await create_deposit_invoice(lease, current_user.org_id)
        except Exception as _dep_exc:
            logger.warning(
                "deposit_invoice_creation_failed",
                lease_id=lease_id,
                org_id=current_user.org_id,
                error=str(_dep_exc),
            )

        # Update onboarding
        if lease.onboarding_id:
            ob = await onboarding_repository.get_by_id(lease.onboarding_id, current_user.org_id)
            if ob:
                ob.status = "activated"
                await onboarding_repository.save(ob)

        UNIT_ASSIGNMENTS.labels(org_id=current_user.org_id).inc()

        await publish(
            "pms.events",
            {
                "org_id": current_user.org_id,
                "user_id": current_user.user_id,
                "action": "lease_activated",
                "lease_id": lease.id,
                "unit_id": lease.unit_id,
                "tenant_id": lease.tenant_id,
                "property_id": lease.property_id,
            },
        )

        await publish(
            "cache.invalidate",
            {
                "org_id": current_user.org_id,
                "user_id": current_user.user_id,
                "keys": [
                    f"{current_user.org_id}:unit:{lease.unit_id}",
                    f"{current_user.org_id}:lease:{lease.id}",
                ],
            },
        )

        await audit_log_repository.create(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            resource_type="lease",
            resource_id=lease_id,
            action="activate",
            after={"status": "active", "unit_status": "occupied"},
        )

    finally:
        await redis.delete(lock_key)

    logger.info(
        "lease_activated",
        action="activate_lease",
        resource_type="lease",
        resource_id=lease_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(lease, unit)


async def sign_lease(lease_id: str, current_user: CurrentUser) -> LeaseResponse:
    """
    Record the tenant's signature. If the lease is pending_signature (fully paid),
    activate it immediately: lease → active, unit → occupied, create inspection.
    """
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if lease.status not in ("draft", "pending_payment", "pending_signature"):
        raise ValidationError(f"Lease cannot be signed in status '{lease.status}'")
    if lease.signed_at:
        raise ValidationError("Lease has already been signed")

    lease.signed_at = utc_now()
    lease.updated_at = utc_now()

    # Check if fully paid
    payments = await payment_repository.list_by_lease(lease_id, current_user.org_id)
    total_paid = sum(
        p.amount for p in payments
        if p.status == "completed" and p.direction == "inbound"
    )
    required = _compute_required(lease)

    if total_paid >= required:
        # Fully paid + now signed → activate
        unit = None
        for from_status in ("booked", "reserved", "vacant"):
            unit = await unit_repository.atomic_status_transition(
                unit_id=lease.unit_id, org_id=current_user.org_id,
                expected_status=from_status, new_status="occupied",
            )
            if unit:
                break

        lease.status = "active"
        lease.activated_at = utc_now()
        await lease_repository.save(lease)

        if lease.onboarding_id:
            ob = await onboarding_repository.get_by_id(lease.onboarding_id, current_user.org_id)
            if ob:
                ob.status = "activated"
                await onboarding_repository.save(ob)

        await publish(
            "pms.events",
            {
                "org_id": current_user.org_id,
                "action": "lease_activated",
                "lease_id": str(lease.id),
                "unit_id": lease.unit_id,
                "tenant_id": lease.tenant_id,
                "property_id": lease.property_id,
            },
        )

        # Create pre-move-in inspection with configurable window
        # Get property config for inspection window days
        window_days = 15
        prop = None
        try:
            prop = await property_repository.get_by_id(lease.property_id, current_user.org_id)
            if prop and prop.unit_policies:
                window_days = prop.unit_policies.move_in_inspection_days
        except Exception as _exc:
            logger.warning("sign_lease_prop_fetch_failed", lease_id=lease_id, exc_info=_exc)

        token = secrets.token_urlsafe(32)
        expires_at = utc_now() + timedelta(days=window_days)
        report = InspectionReport(
            org_id=current_user.org_id,
            lease_id=str(lease.id),
            property_id=lease.property_id,
            unit_id=lease.unit_id,
            tenant_id=lease.tenant_id,
            type="pre_move_in",
            token=token,
            expires_at=expires_at,
            window_days=window_days,
        )
        _, tenant = await asyncio.gather(
            inspection_repository.create(report),
            user_repository.get_by_id(lease.tenant_id),
        )

        # Fetch property name for welcome email
        prop_name = prop.name if prop else "your property"

        if tenant and tenant.email:
            inspection_url = f"{settings.app_base_url}/inspection/{token}"
            html = welcome_move_in_html(
                tenant.first_name or "Tenant",
                prop_name,
                inspection_url,
                window_days,
            )
            await send_email(
                to=str(tenant.email),
                subject="Welcome! Complete your move-in inspection",
                html=html,
            )
    else:
        # Signed but not yet fully paid — stay in pending_payment
        lease.status = "pending_payment"
        await lease_repository.save(lease)
        unit = await unit_repository.get_by_id(PydanticObjectId(lease.unit_id), current_user.org_id)

    logger.info(
        "lease_signed",
        action="sign_lease",
        resource_type="lease", resource_id=lease_id,
        org_id=current_user.org_id, status="success",
    )
    return _to_response(lease, unit)


async def list_leases(
    current_user: CurrentUser,
    pagination: PaginationParams,
    property_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    status: Optional[str] = None,
) -> LeaseListResponse:
    items, total = await lease_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        tenant_id=tenant_id,
        status=status,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    # Batch-fetch units to avoid N+1
    unit_ids = list({l.unit_id for l in items})
    units = await unit_repository.get_by_ids(unit_ids, current_user.org_id)
    unit_map = {str(u.id): u for u in units}


    return LeaseListResponse(
        items=[_to_response(l, unit_map.get(l.unit_id)) for l in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


async def get_lease(lease_id: str, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    return _to_response(lease, unit)


async def sign_lease_from_onboarding(lease_id: str, org_id: str) -> bool:
    """
    Called from the public onboarding wizard (no current_user).
    Marks the lease as signed and activates it if the full move-in payment has been received.
    Returns True if the lease was activated, False if still awaiting payment.
    """
    lease = await lease_repository.get_by_id(lease_id, org_id)
    if not lease:
        return False
    if lease.signed_at:
        return lease.status == "active"
    if lease.status in ("active", "terminated", "expired"):
        return lease.status == "active"

    lease.signed_at = utc_now()
    lease.updated_at = utc_now()

    payments = await payment_repository.list_by_lease(lease_id, org_id)
    total_paid = sum(
        p.amount for p in payments
        if p.status == "completed" and p.direction == "inbound"
    )
    required = _compute_required(lease)

    if total_paid >= required:
        # Fully paid + just signed → activate now
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
        await lease_repository.save(lease)

        if lease.onboarding_id:
            ob = await onboarding_repository.get_by_id(lease.onboarding_id, org_id)
            if ob and ob.status != "activated":
                ob.status = "activated"
                await onboarding_repository.save(ob)

        await publish("pms.events", {
            "org_id": org_id, "action": "lease_activated",
            "lease_id": lease_id, "unit_id": lease.unit_id,
            "tenant_id": lease.tenant_id, "property_id": lease.property_id,
        })

        # Create pre-move-in inspection + send welcome email
        window_days = 15
        prop = None
        try:
            prop = await property_repository.get_by_id(lease.property_id, org_id)
            if prop and prop.unit_policies:
                window_days = prop.unit_policies.move_in_inspection_days
        except Exception as _exc:
            logger.warning("sign_from_onboarding_prop_fetch_failed", lease_id=lease_id, exc_info=_exc)

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
        _, tenant = await asyncio.gather(
            inspection_repository.create(report),
            user_repository.get_by_id(lease.tenant_id),
        )
        if tenant and tenant.email:
            prop_name = prop.name if prop else "your property"
            inspection_url = f"{settings.app_base_url}/inspection/{token}"
            await send_email(
                to=str(tenant.email),
                subject="Welcome! Complete your move-in inspection",
                html=welcome_move_in_html(tenant.first_name or "Tenant", prop_name, inspection_url, window_days),
            )

        logger.info(
            "lease_activated_from_onboarding_sign",
            action="sign_lease_from_onboarding",
            resource_type="lease", resource_id=lease_id,
            org_id=org_id, status="success",
        )
        return True
    else:
        # Signed but not yet fully paid
        lease.status = "pending_payment"
        await lease_repository.save(lease)
        logger.info(
            "lease_signed_pending_payment",
            action="sign_lease_from_onboarding",
            resource_type="lease", resource_id=lease_id,
            org_id=org_id, status="success",
        )
        return False


async def terminate_lease(lease_id: str, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if lease.status in ("terminated", "expired"):
        raise ConflictError("Lease is already terminated or expired")

    now = utc_now()
    lease.status = "terminated"
    lease.terminated_at = now
    lease.terminated_by = current_user.user_id
    lease.updated_at = now
    await lease.save()

    # Apply early termination penalty if configured
    if lease.early_termination:
        et = lease.early_termination
        if et.penalty_type == "months":
            penalty = round(et.penalty_value * lease.rent_amount, 2)
        else:
            penalty = et.penalty_value
        if penalty > 0:
            from app.models.ledger_entry import LedgerEntry
            lb = await ledger_repository.last_balance(str(lease.id), current_user.org_id)
            await ledger_repository.create(LedgerEntry(
                org_id=current_user.org_id, lease_id=str(lease.id),
                property_id=lease.property_id, tenant_id=lease.tenant_id,
                type="debit", category="termination_fee", amount=penalty,
                description=f"Early termination penalty ({et.penalty_type} × {et.penalty_value})",
                running_balance=lb + penalty,
            ))

    # Free the unit back to vacant
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    if unit and unit.status == "occupied":
        unit.status = "vacant"
        unit.updated_at = now
        await unit.save()

    logger.info("lease_terminated", action="terminate_lease", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")

    return _to_response(lease, unit)


async def resend_invite(lease_id: str, current_user: CurrentUser) -> None:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if lease.status not in ("draft", "pending_payment", "pending_signature"):
        raise ValidationError("Invite can only be resent for unsigned leases")

    # Get onboarding for the token
    onboarding = await onboarding_repository.get_by_lease_id(lease_id, current_user.org_id)
    if not onboarding:
        raise ResourceNotFoundError("Onboarding", lease_id)

    tenant = await user_repository.get_by_id(lease.tenant_id)
    if not tenant or not tenant.email:
        raise ValidationError("Tenant has no email address")

    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    org = await org_repository.get_or_create(current_user.org_id)

    from app.core.email import lease_created_tenant_html
    invite_url = f"{settings.app_base_url}/onboarding/{onboarding.invite_token}"
    tenant_name = f"{tenant.first_name} {tenant.last_name}".strip()
    unit_label = unit.unit_code if unit else "your unit"

    html = lease_created_tenant_html(
        tenant.first_name or tenant_name,
        lease.reference_no,
        invite_url,
    )
    await send_email(
        to=str(tenant.email),
        subject=f"Lease Invitation (Resent) — {unit_label}",
        html=html,
    )

    lease.last_reminder_sent_at = utc_now()
    lease.reminder_count = (lease.reminder_count or 0) + 1
    await lease.save()

    logger.info("lease_invite_resent", action="resend_invite", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")


async def get_lease_pdf_url(lease_id: str, current_user: CurrentUser) -> str:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if not lease.onboarding_id:
        raise ValidationError("No lease document found — onboarding not linked")

    from app.core.s3 import generate_presigned_url
    from app.repositories.onboarding_repository import onboarding_repository as ob_repo
    onboarding = await ob_repo.get_by_id(lease.onboarding_id, current_user.org_id)
    if not onboarding or not onboarding.pdf_key:
        raise ValidationError("Lease PDF has not been generated yet")

    url = await generate_presigned_url(onboarding.pdf_key)
    return url


async def add_discount(lease_id: str, data: LeaseDiscountCreateRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import LeaseDiscount
    from app.models.ledger_entry import LedgerEntry
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if lease.status not in ("active", "pending_payment", "pending_signature", "draft"):
        raise ValidationError("Cannot add discount to a terminated or expired lease")

    discount = LeaseDiscount(
        label=data.label,
        type=data.type,
        value=data.value,
        effective_from=data.effective_from,
        effective_to=data.effective_to,
        note=data.note,
        recorded_by=str(current_user.user_id),
    )
    lease.discounts = lease.discounts or []
    lease.discounts.append(discount)
    lease.updated_at = utc_now()
    await lease.save()

    # Record discount as a debit (expense) in the ledger
    if data.type == "fixed":
        disc_amount = data.value
    else:
        disc_amount = round(lease.rent_amount * data.value / 100, 2)

    ledger_balance = await ledger_repository.last_balance(str(lease.id), current_user.org_id)
    ledger_entry = LedgerEntry(
        org_id=current_user.org_id,
        lease_id=str(lease.id),
        property_id=lease.property_id,
        tenant_id=lease.tenant_id,
        type="debit",
        category="discount",
        amount=disc_amount,
        description=(
            f"Rent discount applied: {data.label} "
            f"({data.type} {data.value}{'%' if data.type == 'percentage' else ' KES'})"
        ),
        running_balance=ledger_balance + disc_amount,
    )
    await ledger_repository.create(ledger_entry)

    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_discount_added", action="add_discount", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


async def remove_discount(lease_id: str, discount_id: str, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    original_len = len(lease.discounts or [])
    lease.discounts = [d for d in (lease.discounts or []) if d.id != discount_id]
    if len(lease.discounts) == original_len:
        raise ResourceNotFoundError("Discount", discount_id)

    lease.updated_at = utc_now()
    await lease.save()

    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_discount_removed", action="remove_discount", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


def _unit_utility_deposits(unit) -> float:
    if not unit or not unit.utility_overrides:
        return 0.0
    total = 0.0
    for key in ("electricity", "water", "gas", "internet", "garbage", "security"):
        od = getattr(unit.utility_overrides, key, None)
        if od and od.deposit:
            total += od.deposit
    return total


def _compute_effective_rent(lease: Lease) -> tuple:
    """
    Returns (effective_rent, total_discount_amount, discount_responses).
    Applies all active discounts for today's date.
    """
    from datetime import date as _date
    today = _date.today()
    rent = lease.rent_amount
    total_discount = 0.0
    responses = []
    for d in (lease.discounts or []):
        active = d.effective_from <= today and (d.effective_to is None or d.effective_to >= today)
        if d.type == "fixed":
            disc_amount = d.value
        else:  # percentage
            disc_amount = round(lease.rent_amount * d.value / 100, 2)
        responses.append({
            "id": d.id, "label": d.label, "type": d.type, "value": d.value,
            "effective_from": d.effective_from, "effective_to": d.effective_to,
            "note": d.note, "recorded_by": d.recorded_by, "created_at": d.created_at,
            "effective_rent": round(lease.rent_amount - disc_amount, 2),
            "discount_amount": disc_amount,
        })
        if active:
            total_discount += disc_amount
    effective_rent = max(0.0, round(rent - total_discount, 2))
    return effective_rent, total_discount, responses


def _escalation_responses(lease: Lease) -> list:
    from app.schemas.lease import RentEscalationResponse
    result = []
    for e in (lease.escalations or []):
        result.append(RentEscalationResponse(
            id=e.id, effective_date=e.effective_date, new_rent_amount=e.new_rent_amount,
            percentage_increase=e.percentage_increase, applied=e.applied,
            applied_at=e.applied_at, note=e.note, created_by=e.created_by, created_at=e.created_at,
        ))
    return result


def _early_termination_response(lease: Lease):
    from app.schemas.lease import EarlyTerminationTermsResponse
    if not lease.early_termination:
        return None
    et = lease.early_termination
    if et.penalty_type == "months":
        penalty_amount = round(et.penalty_value * lease.rent_amount, 2)
    else:
        penalty_amount = et.penalty_value
    return EarlyTerminationTermsResponse(
        penalty_type=et.penalty_type, penalty_value=et.penalty_value,
        notice_days=et.notice_days, note=et.note, penalty_amount=penalty_amount,
    )


def _renewal_offer_response(lease: Lease):
    from app.schemas.lease import RenewalOfferResponse
    if not lease.renewal_offer:
        return None
    o = lease.renewal_offer
    return RenewalOfferResponse(
        id=o.id, new_rent_amount=o.new_rent_amount, new_end_date=o.new_end_date,
        message=o.message, status=o.status, sent_at=o.sent_at,
        responded_at=o.responded_at, created_by=o.created_by,
    )


def _co_tenant_responses(lease: Lease) -> list:
    from app.schemas.lease import CoTenantResponse
    result = []
    for c in (lease.co_tenants or []):
        result.append(CoTenantResponse(
            id=c.id, role=c.role, first_name=c.first_name, last_name=c.last_name,
            email=c.email, phone=c.phone, id_type=c.id_type, id_number=c.id_number,
            added_at=c.added_at, added_by=c.added_by,
        ))
    return result


def _note_responses(lease: Lease) -> list:
    from app.schemas.lease import LeaseNoteResponse
    result = []
    for n in (lease.notes_internal or []):
        result.append(LeaseNoteResponse(
            id=n.id, body=n.body, is_private=n.is_private,
            created_by=n.created_by, created_at=n.created_at,
        ))
    return result


def _rating_response(lease: Lease):
    from app.schemas.lease import TenantRatingResponse
    if not lease.rating:
        return None
    r = lease.rating
    return TenantRatingResponse(
        score=r.score, payment_timeliness=r.payment_timeliness,
        property_care=r.property_care, communication=r.communication,
        note=r.note, rated_by=r.rated_by, rated_at=r.rated_at,
    )


def _to_response(lease: Lease, unit=None, onboarding_token: Optional[str] = None) -> LeaseResponse:
    effective_rent, discount_amount, discount_responses = _compute_effective_rent(lease)
    return LeaseResponse(
        id=str(lease.id),
        reference_no=lease.reference_no,
        org_id=lease.org_id,
        property_id=str(lease.property_id),
        unit_id=str(lease.unit_id),
        unit_code=unit.unit_code if unit else None,
        tenant_id=str(lease.tenant_id),
        onboarding_id=str(lease.onboarding_id) if lease.onboarding_id else None,
        onboarding_token=onboarding_token,
        status=lease.status,
        start_date=lease.start_date,
        end_date=lease.end_date,
        rent_amount=lease.rent_amount,
        deposit_amount=lease.deposit_amount,
        utility_deposit=lease.utility_deposit,
        unit_utility_deposits=_unit_utility_deposits(unit),
        notes=lease.notes,
        signed_at=lease.signed_at,
        activated_at=lease.activated_at,
        terminated_at=lease.terminated_at,
        created_at=lease.created_at,
        updated_at=lease.updated_at,
        discounts=discount_responses,
        effective_rent=effective_rent,
        discount_amount=discount_amount,
        escalations=_escalation_responses(lease),
        early_termination=_early_termination_response(lease),
        renewal_offer=_renewal_offer_response(lease),
        co_tenants=_co_tenant_responses(lease),
        notes_internal=_note_responses(lease),
        rating=_rating_response(lease),
    )


# ── Rent Escalation ───────────────────────────────────────────────────────────

async def add_escalation(lease_id: str, data: RentEscalationCreateRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import RentEscalation
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    pct = round((data.new_rent_amount - lease.rent_amount) / lease.rent_amount * 100, 2) if lease.rent_amount else None
    esc = RentEscalation(
        effective_date=data.effective_date, new_rent_amount=data.new_rent_amount,
        percentage_increase=pct, note=data.note, created_by=str(current_user.user_id),
    )
    lease.escalations = (lease.escalations or [])
    lease.escalations.append(esc)
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_escalation_added", action="add_escalation", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


async def remove_escalation(lease_id: str, escalation_id: str, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    original = len(lease.escalations or [])
    lease.escalations = [e for e in (lease.escalations or []) if e.id != escalation_id]
    if len(lease.escalations) == original:
        raise ResourceNotFoundError("Escalation", escalation_id)
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_escalation_removed", action="remove_escalation", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


# ── Early Termination ─────────────────────────────────────────────────────────

async def set_early_termination_terms(lease_id: str, data: EarlyTerminationTermsRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import EarlyTerminationTerms
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    lease.early_termination = EarlyTerminationTerms(**data.model_dump())
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_early_termination_set", action="set_early_termination_terms", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


# ── Renewal Offer ─────────────────────────────────────────────────────────────

async def send_renewal_offer(lease_id: str, data: RenewalOfferCreateRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import RenewalOffer
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if lease.status != "active":
        raise ValidationError("Can only send renewal offer for active leases")
    offer = RenewalOffer(
        new_rent_amount=data.new_rent_amount, new_end_date=data.new_end_date,
        message=data.message, created_by=str(current_user.user_id),
    )
    lease.renewal_offer = offer
    lease.updated_at = utc_now()
    await lease.save()

    # Send email to tenant
    tenant = await user_repository.get_by_id(lease.tenant_id)
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    org = await org_repository.get_or_create(current_user.org_id)
    if tenant and tenant.email:
        from app.core.email import send_email as _send, _base
        tenant_name = f"{tenant.first_name} {tenant.last_name}".strip()
        unit_label = unit.unit_code if unit else "your unit"
        org_name = org.business.name if org and org.business else ""
        end_str = data.new_end_date.strftime("%d %b %Y") if data.new_end_date else "rolling"
        html = _base("Lease Renewal Offer", f"""
            <h2>Lease Renewal Offer</h2>
            <p>Dear <strong>{tenant_name}</strong>,</p>
            <p>Your landlord has sent you a lease renewal offer for <strong>{unit_label}</strong>.</p>
            <table style="border-collapse:collapse;margin:16px 0;width:100%">
              <tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">New Monthly Rent</td>
                  <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">KES {data.new_rent_amount:,.0f}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280">New End Date</td>
                  <td style="padding:8px;border:1px solid #e5e7eb">{end_str}</td></tr>
            </table>
            {f'<p style="color:#374151">{data.message}</p>' if data.message else ''}
            <p>Please log in to your tenant portal to accept or decline this offer.</p>
        """)
        await _send(to=str(tenant.email), subject=f"Lease Renewal Offer — {unit_label} ({org_name})", html=html)

    logger.info("lease_renewal_offer_sent", action="send_renewal_offer", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


async def respond_renewal_offer(lease_id: str, accept: bool, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    if not lease.renewal_offer or lease.renewal_offer.status != "pending":
        raise ValidationError("No pending renewal offer found")
    lease.renewal_offer.status = "accepted" if accept else "declined"
    lease.renewal_offer.responded_at = utc_now()
    if accept:
        lease.rent_amount = lease.renewal_offer.new_rent_amount
        if lease.renewal_offer.new_end_date:
            lease.end_date = lease.renewal_offer.new_end_date
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_renewal_offer_responded", action="respond_renewal_offer", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


# ── Co-tenants ────────────────────────────────────────────────────────────────

async def add_co_tenant(lease_id: str, data: CoTenantCreateRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import CoTenant
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    co = CoTenant(**data.model_dump(), added_by=str(current_user.user_id))
    lease.co_tenants = (lease.co_tenants or [])
    lease.co_tenants.append(co)
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_co_tenant_added", action="add_co_tenant", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


async def remove_co_tenant(lease_id: str, co_tenant_id: str, current_user: CurrentUser) -> LeaseResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    lease.co_tenants = [c for c in (lease.co_tenants or []) if c.id != co_tenant_id]
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_co_tenant_removed", action="remove_co_tenant", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


# ── Notes & Rating ────────────────────────────────────────────────────────────

async def add_note(lease_id: str, data: LeaseNoteCreateRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import LeaseNote
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    note = LeaseNote(body=data.body, is_private=data.is_private, created_by=str(current_user.user_id))
    lease.notes_internal = (lease.notes_internal or [])
    lease.notes_internal.append(note)
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_note_added", action="add_note", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)


async def rate_tenant(lease_id: str, data: TenantRatingRequest, current_user: CurrentUser) -> LeaseResponse:
    from app.models.lease import TenantRating
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    lease.rating = TenantRating(**data.model_dump(), rated_by=str(current_user.user_id))
    lease.updated_at = utc_now()
    await lease.save()
    unit = await unit_repository.get_by_id(lease.unit_id, current_user.org_id)
    logger.info("lease_tenant_rated", action="rate_tenant", resource_type="lease",
                resource_id=lease_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(lease, unit)
