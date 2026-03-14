"""
Onboarding API — initiation, invite (email), KYC uploads, personal details,
public wizard endpoint (no auth, token-based).
"""
import base64
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, UploadFile, File
from redis.asyncio import Redis

from app.core.email import send_email, tenant_invite_html, onboarding_complete_html, lease_signed_pdf_html
from app.core.config import settings
from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.core.s3 import upload_file, generate_presigned_url, download_file
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.dependencies.redis import get_redis_dep
from app.models.onboarding import Onboarding
from app.repositories.onboarding_repository import onboarding_repository
from app.repositories.property_repository import property_repository
from app.repositories.lease_repository import lease_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.org_repository import org_repository
from app.schemas.onboarding import (
    LeaseSummary,
    PaymentConfigSummary,
    UtilityContractLine,
    OnboardingCreateRequest,
    OnboardingDetailsRequest,
    OnboardingDocumentsResponse,
    OnboardingInviteRequest,
    OnboardingListResponse,
    OnboardingOwnerSignRequest,
    OnboardingPayRequest,
    OnboardingPayResponse,
    OnboardingPayStatusResponse,
    OnboardingPublicResponse,
    OnboardingReserveUnitRequest,
    OnboardingResponse,
    OnboardingSignRequest,
    OnboardingVerifyResponse,
)
from app.repositories.payment_repository import payment_repository
from app.services import payment_service as _payment_service
from app.services.mfa_service import mfa_service
from app.services import unit_service, lease_service
from app.utils.datetime import utc_now
from app.utils.pdf import generate_lease_pdf

router = APIRouter(prefix="/onboardings", tags=["onboardings"])


# ── Staff endpoints (auth required) ──────────────────────────────────────────

@router.post(
    "",
    response_model=OnboardingResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_onboarding(
    request: OnboardingCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    ob = Onboarding(
        org_id=current_user.org_id,
        property_id=request.property_id,
        tenant_id=request.tenant_id,
        lease_id=request.lease_id,
        initiated_by=current_user.user_id,
        notes=request.notes,
        status="initiated",
    )
    await onboarding_repository.create(ob)
    return await _to_response(ob)


@router.get(
    "",
    response_model=OnboardingListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_onboardings(
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    property_id: Optional[str] = Query(default=None),
    tenant_id: Optional[str] = Query(default=None),
    lease_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> OnboardingListResponse:
    items, total = await onboarding_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        tenant_id=tenant_id,
        lease_id=lease_id,
        status=status,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return OnboardingListResponse(
        items=[await _to_response(o) for o in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    "/{onboarding_id}",
    response_model=OnboardingResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_onboarding(
    onboarding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise ResourceNotFoundError("Onboarding", onboarding_id)
    return await _to_response(ob)


@router.get(
    "/{onboarding_id}/documents",
    response_model=OnboardingDocumentsResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def get_onboarding_documents(
    onboarding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
    x_mfa_session_token: Optional[str] = Header(default=None, alias="X-MFA-Session-Token"),
) -> OnboardingDocumentsResponse:
    """Fetch presigned document URLs — requires active MFA session (owner/superadmin only)."""
    if not x_mfa_session_token:
        raise HTTPException(status_code=403, detail="MFA session token required")
    valid = await mfa_service.validate_session(current_user.user_id, x_mfa_session_token, redis)
    if not valid:
        raise HTTPException(status_code=403, detail="MFA session expired or invalid")

    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise ResourceNotFoundError("Onboarding", onboarding_id)

    id_front_url = await generate_presigned_url(ob.id_front_key) if ob.id_front_key else None
    id_back_url = await generate_presigned_url(ob.id_back_key) if ob.id_back_key else None
    selfie_url = await generate_presigned_url(ob.selfie_key) if ob.selfie_key else None
    signature_url = await generate_presigned_url(ob.signature_key) if ob.signature_key else None

    return OnboardingDocumentsResponse(
        onboarding_id=ob.id,
        status=ob.status,
        id_front_url=id_front_url,
        id_back_url=id_back_url,
        selfie_url=selfie_url,
        signature_url=signature_url,
        signed_at=ob.signed_at,
        id_type=ob.id_type,
        id_number=ob.id_number,
        first_name=ob.first_name,
        last_name=ob.last_name,
        date_of_birth=ob.date_of_birth,
        phone=ob.phone,
        emergency_contact_name=ob.emergency_contact_name,
        emergency_contact_phone=ob.emergency_contact_phone,
    )


@router.get(
    "/{onboarding_id}/lease-pdf",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_lease_pdf_url(
    onboarding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return a presigned S3 URL to download the stored lease PDF."""
    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if not ob.pdf_key:
        raise HTTPException(status_code=404, detail="PDF not yet generated for this onboarding")
    url = await generate_presigned_url(ob.pdf_key)
    return {"url": url}


@router.post(
    "/{onboarding_id}/reserve-unit",
    response_model=OnboardingResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def reserve_unit_for_onboarding(
    onboarding_id: str,
    request: OnboardingReserveUnitRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> OnboardingResponse:
    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise ResourceNotFoundError("Onboarding", onboarding_id)

    await unit_service.reserve_unit(
        unit_id=request.unit_id,
        tenant_id=ob.tenant_id or "",
        onboarding_id=onboarding_id,
        current_user=current_user,
        redis=redis,
    )

    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    return await _to_response(ob)


@router.post(
    "/{onboarding_id}/invite",
    response_model=OnboardingResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_invite(
    onboarding_id: str,
    request: OnboardingInviteRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise ResourceNotFoundError("Onboarding", onboarding_id)

    if ob.status in ("activated", "signed", "cancelled"):
        raise ConflictError(f"Cannot send invite — onboarding is already {ob.status}")

    token = secrets.token_urlsafe(32)
    invite_url = f"{settings.app_base_url}/onboarding/{token}"

    ob.invite_token = token
    ob.invite_email = request.email
    ob.invite_sent_at = utc_now()
    ob.status = "invited"
    await onboarding_repository.save(ob)

    prop = await property_repository.get_by_id(ob.property_id, current_user.org_id)
    property_name = prop.name if prop else "the property"
    org_name = current_user.org_id

    await send_email(
        to=request.email,
        subject="You're invited to complete your tenant onboarding",
        html=tenant_invite_html(invite_url, property_name, org_name),
    )

    return await _to_response(ob)


@router.post(
    "/{onboarding_id}/owner-sign",
    response_model=OnboardingResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def owner_sign_contract(
    onboarding_id: str,
    request: OnboardingOwnerSignRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    """
    Save the owner/agent countersignature.
    If the tenant has already signed, regenerates the PDF and re-sends to the tenant.
    """
    ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
    if not ob:
        raise ResourceNotFoundError("Onboarding", onboarding_id)

    # Decode + store owner signature
    try:
        sig_b64 = request.signature_data.split(",", 1)[-1]
        sig_bytes = base64.b64decode(sig_b64)
        key = f"{ob.org_id}/onboarding/{ob.id}/owner_signature.png"
        await upload_file(key=key, body=sig_bytes, content_type="image/png")
        ob.owner_signature_key = key
    except Exception as exc:
        import structlog as _sl
        _sl.get_logger(__name__).warning("owner_sign_upload_failed", exc_info=exc)
        sig_bytes = None

    ob.owner_signed_at = utc_now()
    ob.owner_signed_by = request.signed_by

    # Resolve display name: request → org business name → org_id
    if not ob.owner_signed_by:
        try:
            org = await org_repository.get_by_org_id(ob.org_id)
            if org and org.business and org.business.name:
                ob.owner_signed_by = org.business.name
        except Exception:
            pass

    await onboarding_repository.save(ob)

    # If tenant already signed, regenerate PDF and re-send
    if ob.status in ("signed", "activated") and ob.invite_email and ob.lease_id:
        try:
            await _generate_and_send_lease_pdf(ob, signer_ip=None)
        except Exception as exc:
            import structlog as _sl
            _sl.get_logger(__name__).warning("owner_sign_pdf_resend_failed", exc_info=exc)

    return await _to_response(ob)


# ── Public verification endpoints (no auth) ──────────────────────────────────

@router.get(
    "/verify/{onboarding_id}",
    response_model=OnboardingVerifyResponse,
)
async def verify_by_code(
    onboarding_id: str,
    code: str = Query(..., description="8-character verification code from the lease PDF"),
) -> OnboardingVerifyResponse:
    """Verify a lease document's authenticity by entering the code printed in the PDF annex."""
    ob = await onboarding_repository.get_by_id_public(onboarding_id)
    if not ob:
        raise HTTPException(status_code=404, detail="Document not found")

    is_authentic = bool(ob.verification_code and ob.verification_code.lower() == code.strip().lower())
    return await _build_verify_response(ob, is_authentic)


@router.post(
    "/verify/{onboarding_id}/document",
    response_model=OnboardingVerifyResponse,
)
async def verify_by_document(
    onboarding_id: str,
    file: UploadFile = File(...),
) -> OnboardingVerifyResponse:
    """Verify a lease document by uploading the PDF and comparing its SHA-256 hash."""
    ob = await onboarding_repository.get_by_id_public(onboarding_id)
    if not ob:
        raise HTTPException(status_code=404, detail="Document not found")

    content = await file.read()
    uploaded_hash = hashlib.sha256(content).hexdigest()
    is_authentic = bool(ob.pdf_hash and ob.pdf_hash == uploaded_hash)
    return await _build_verify_response(ob, is_authentic)


async def _build_verify_response(ob: "Onboarding", is_authentic: bool) -> OnboardingVerifyResponse:
    """Build OnboardingVerifyResponse from an Onboarding document."""
    property_name = None
    unit_code = None
    start_date = None
    end_date = None
    rent_amount = None

    if ob.lease_id:
        try:
            lease = await lease_repository.get_by_id(ob.lease_id, ob.org_id)
            if lease:
                start_date = str(lease.start_date) if lease.start_date else None
                end_date = str(lease.end_date) if lease.end_date else None
                rent_amount = lease.rent_amount
                unit = await unit_repository.get_by_id(lease.unit_id, ob.org_id)
                unit_code = unit.unit_code if unit else None
        except Exception:
            pass

    if ob.property_id:
        try:
            prop = await property_repository.get_by_id(ob.property_id, ob.org_id)
            property_name = prop.name if prop else None
        except Exception:
            pass

    tenant_name = " ".join(filter(None, [ob.first_name, ob.last_name])) or None

    return OnboardingVerifyResponse(
        onboarding_id=str(ob.id),
        is_authentic=is_authentic,
        tenant_name=tenant_name,
        property_name=property_name,
        unit_code=unit_code,
        start_date=start_date,
        end_date=end_date,
        rent_amount=rent_amount,
        signed_at=ob.signed_at,
        owner_signed_at=ob.owner_signed_at,
        owner_signed_by=ob.owner_signed_by,
        doc_fingerprint=ob.doc_fingerprint if is_authentic else None,
        status=ob.status,
    )


# ── Public wizard endpoints (token-based, no auth) ───────────────────────────

@router.get(
    "/invite/{token}",
    response_model=OnboardingPublicResponse,
)
async def get_onboarding_by_token(token: str) -> OnboardingPublicResponse:
    ob = await onboarding_repository.get_by_token(token)
    if not ob:
        raise ResourceNotFoundError("Onboarding", token)
    return await _public_response(ob)


@router.post(
    "/invite/{token}/upload-id-front",
    response_model=OnboardingPublicResponse,
)
async def upload_id_front(token: str, file: UploadFile = File(...)) -> OnboardingPublicResponse:
    ob = await _get_by_token_or_404(token)
    key = await _upload_doc(ob, file, "id_front")
    ob.id_front_key = key
    await onboarding_repository.save(ob)
    return await _public_response(ob)


@router.post(
    "/invite/{token}/upload-id-back",
    response_model=OnboardingPublicResponse,
)
async def upload_id_back(token: str, file: UploadFile = File(...)) -> OnboardingPublicResponse:
    ob = await _get_by_token_or_404(token)
    key = await _upload_doc(ob, file, "id_back")
    ob.id_back_key = key
    await onboarding_repository.save(ob)
    return await _public_response(ob)


@router.post(
    "/invite/{token}/upload-selfie",
    response_model=OnboardingPublicResponse,
)
async def upload_selfie(token: str, file: UploadFile = File(...)) -> OnboardingPublicResponse:
    ob = await _get_by_token_or_404(token)
    key = await _upload_doc(ob, file, "selfie")
    ob.selfie_key = key
    await onboarding_repository.save(ob)
    return await _public_response(ob)


@router.patch(
    "/invite/{token}/details",
    response_model=OnboardingPublicResponse,
)
async def submit_details(
    token: str,
    request: OnboardingDetailsRequest,
) -> OnboardingPublicResponse:
    ob = await _get_by_token_or_404(token)

    updates = request.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(ob, field, value)

    # Advance to kyc_submitted only if docs present; signing happens separately
    if ob.id_front_key and ob.id_back_key and ob.selfie_key and ob.id_number:
        if ob.status not in ("signed", "activated"):
            ob.status = "kyc_submitted"
    await onboarding_repository.save(ob)

    return await _public_response(ob)


@router.post(
    "/invite/{token}/sign",
    response_model=OnboardingPublicResponse,
)
async def sign_contract(
    token: str,
    request: OnboardingSignRequest,
    req: Request,
) -> OnboardingPublicResponse:
    ob = await _get_by_token_or_404(token)

    # Decode base64 data URL and store as PNG in S3
    sig_bytes: Optional[bytes] = None
    try:
        sig_b64 = request.signature_data.split(",", 1)[-1]
        sig_bytes = base64.b64decode(sig_b64)
        key = f"{ob.org_id}/onboarding/{ob.id}/signature.png"
        await upload_file(key=key, body=sig_bytes, content_type="image/png")
        ob.signature_key = key
    except Exception:
        pass  # non-fatal; status still advances

    ob.status = "signed"
    ob.signed_at = utc_now()

    # ── Auto-sign: apply org/property default signature if configured ─────────
    owner_sig_bytes_auto: Optional[bytes] = None
    try:
        prop = await property_repository.get_by_id(ob.property_id, ob.org_id)
        org  = await org_repository.get_by_org_id(ob.org_id)
        # Property-level overrides org-level
        sig_cfg = (prop.signature_config if prop and prop.signature_config and prop.signature_config.signature_key else None) \
                  or (org.signature_config if org and org.signature_config and org.signature_config.signature_key else None)
        if sig_cfg and sig_cfg.signature_key:
            owner_sig_bytes_auto = await download_file(sig_cfg.signature_key)
            key = f"{ob.org_id}/onboarding/{ob.id}/owner_signature.png"
            await upload_file(key=key, body=owner_sig_bytes_auto, content_type="image/png")
            ob.owner_signature_key = key
            ob.owner_signed_at = utc_now()
            ob.owner_signed_by = sig_cfg.signatory_name or (org.business.name if org and org.business else None)
    except Exception as _exc:
        import structlog as _sl
        _sl.get_logger(__name__).warning("auto_sign_failed", onboarding_id=str(ob.id), exc_info=_exc)

    await onboarding_repository.save(ob)

    # Mark the linked lease as signed (and activate if fully paid)
    activated = False
    if ob.lease_id:
        try:
            activated = await lease_service.sign_lease_from_onboarding(ob.lease_id, ob.org_id)
        except Exception as _exc:
            import structlog as _sl
            _sl.get_logger(__name__).warning(
                "sign_contract_lease_update_failed", onboarding_id=str(ob.id), exc_info=_exc,
            )

    # Generate PDF and email it to the tenant
    if ob.invite_email:
        try:
            signer_ip = req.client.host if req.client else None
            pdf_bytes = await _generate_and_send_lease_pdf(
                ob, signer_ip=signer_ip, sig_bytes=sig_bytes, activated=activated,
                owner_sig_bytes_override=owner_sig_bytes_auto,
            )
            # Store verification metadata
            if pdf_bytes:
                ob.pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
                await onboarding_repository.save(ob)
        except Exception as _exc:
            import structlog as _sl
            _sl.get_logger(__name__).warning(
                "sign_contract_pdf_email_failed", onboarding_id=str(ob.id), exc_info=_exc,
            )

    return await _public_response(ob)


@router.post(
    "/invite/{token}/pay",
    response_model=OnboardingPayResponse,
)
async def initiate_payment(
    token: str,
    request: OnboardingPayRequest,
) -> OnboardingPayResponse:
    """Initiate move-in payment from the public onboarding wizard."""
    ob = await _get_by_token_or_404(token)
    if ob.status in ("cancelled",):
        from app.core.exceptions import ConflictError as _CE
        raise _CE("Onboarding has been cancelled")

    payment = await _payment_service.initiate_onboarding_payment(
        ob=ob,
        phone=request.phone,
        amount=request.amount,
        sandbox=request.sandbox,
    )
    message = (
        "Payment received." if payment.status == "completed"
        else "STK push sent to your phone. Enter your Mpesa PIN to complete."
    )
    return OnboardingPayResponse(
        payment_id=str(payment.id),
        status=payment.status,
        message=message,
    )


@router.get(
    "/invite/{token}/pay-status",
    response_model=OnboardingPayStatusResponse,
)
async def get_payment_status(
    token: str,
    payment_id: str = Query(...),
) -> OnboardingPayStatusResponse:
    """Poll payment status from the public onboarding wizard."""
    ob = await _get_by_token_or_404(token)
    payment = await payment_repository.get_by_id(payment_id, ob.org_id)
    if not payment or payment.lease_id != str(ob.lease_id):
        raise ResourceNotFoundError("Payment", payment_id)

    lease_status = "unknown"
    if ob.lease_id:
        lease = await lease_repository.get_by_id(ob.lease_id, ob.org_id)
        lease_status = lease.status if lease else "unknown"

    message = None
    if payment.status == "completed":
        message = "Payment received! Your lease is being processed."
    elif payment.status == "failed":
        message = "Payment failed. Please try again or use manual payment."

    return OnboardingPayStatusResponse(
        status=payment.status,
        lease_status=lease_status,
        message=message,
    )


# ── Private helpers ───────────────────────────────────────────────────────────

async def _generate_and_send_lease_pdf(
    ob: Onboarding,
    *,
    signer_ip: Optional[str] = None,
    sig_bytes: Optional[bytes] = None,
    activated: bool = False,
    owner_sig_bytes_override: Optional[bytes] = None,
) -> Optional[bytes]:
    """Fetch all context, generate the lease PDF, email it, and return raw PDF bytes."""
    prop = await property_repository.get_by_id(ob.property_id, ob.org_id)
    org  = await org_repository.get_by_org_id(ob.org_id)

    lease_obj = None
    unit_obj  = None
    if ob.lease_id:
        lease_obj = await lease_repository.get_by_id(ob.lease_id, ob.org_id)
        if lease_obj:
            unit_obj = await unit_repository.get_by_id(lease_obj.unit_id, ob.org_id)

    # Build utility lines for the PDF
    utils: list = []
    if prop and lease_obj:
        prop_utils = prop.utility_defaults
        unit_ov = unit_obj.utility_overrides if unit_obj and hasattr(unit_obj, "utility_overrides") else None
        std_keys = ("electricity", "water", "gas", "internet", "garbage", "security")
        std_labels = dict(zip(std_keys, ("Electricity", "Water", "Gas", "Internet", "Garbage Collection", "Security")))
        for key in std_keys:
            base_u = getattr(prop_utils, key, None)
            ov = getattr(unit_ov, key, None) if unit_ov else None
            detail = ov or base_u
            if detail:
                utils.append(type("U", (), {
                    "label": detail.label or std_labels[key],
                    "type": detail.type,
                    "rate": detail.rate,
                    "unit_label": detail.unit,
                    "deposit": detail.deposit,
                })())
        for cu in (prop_utils.custom or []):
            utils.append(type("U", (), {
                "label": cu.label or cu.key,
                "type": cu.type,
                "rate": cu.rate,
                "unit_label": cu.unit,
                "deposit": cu.deposit,
            })())

    # Org branding
    org_biz   = org.business if org else None
    org_name  = (org_biz.name if org_biz else None) or ob.org_id
    org_phone = org_biz.phone if org_biz else None
    org_email = org_biz.email if org_biz else None
    org_addr  = org_biz.address if org_biz else None

    # Logo bytes
    org_logo_bytes: Optional[bytes] = None
    if org_biz and org_biz.logo_url:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as http_client:
                resp = await http_client.get(org_biz.logo_url)
                if resp.status_code == 200:
                    org_logo_bytes = resp.content
        except Exception:
            pass

    # Owner signature bytes (passed in if auto-signed, otherwise load from S3)
    owner_sig_bytes: Optional[bytes] = owner_sig_bytes_override
    if owner_sig_bytes is None and ob.owner_signature_key:
        try:
            owner_sig_bytes = await download_file(ob.owner_signature_key)
        except Exception:
            pass

    # Tenant signature bytes (if not passed in)
    if sig_bytes is None and ob.signature_key:
        try:
            sig_bytes = await download_file(ob.signature_key)
        except Exception:
            pass

    # Payment config summary
    pc_summary = None
    if prop and prop.payment_config:
        pc_summary = _resolve_payment_config(prop.payment_config, unit_obj, ob)

    # Billing / lease defaults
    bs = prop.billing_settings if prop else None
    ld = prop.lease_defaults if prop else None
    pd = prop.pricing_defaults if prop else None

    tenant_name    = " ".join(filter(None, [ob.first_name, ob.last_name])) or "Tenant"
    signed_at_str  = ob.signed_at.strftime("%-d %B %Y %H:%M UTC") if ob.signed_at else None
    owner_sat_str  = ob.owner_signed_at.strftime("%-d %B %Y %H:%M UTC") if ob.owner_signed_at else None

    pdf_bytes = generate_lease_pdf(
        onboarding_id=str(ob.id),
        property_id=ob.property_id,
        reference_no=getattr(lease_obj, "reference_no", "") if lease_obj else "",
        org_name=org_name,
        org_phone=org_phone,
        org_email=org_email,
        org_address=org_addr,
        org_logo_bytes=org_logo_bytes,
        landlord_name=org_biz.name if org_biz else None,
        landlord_address=org_biz.address if org_biz else None,
        tenant_name=tenant_name,
        tenant_id_type=ob.id_type,
        tenant_id_number=ob.id_number,
        tenant_phone=ob.phone,
        tenant_email=ob.invite_email,
        tenant_emergency_contact_name=ob.emergency_contact_name,
        tenant_emergency_contact_phone=ob.emergency_contact_phone,
        property_name=prop.name if prop else "Property",
        property_address=(
            ", ".join(filter(None, [
                prop.address.street, prop.address.city,
                prop.address.state, prop.address.country,
            ])) if prop and prop.address else None
        ),
        unit_code=unit_obj.unit_code if unit_obj else None,
        start_date=lease_obj.start_date if lease_obj else None,
        end_date=getattr(lease_obj, "end_date", None) if lease_obj else None,
        rent_amount=lease_obj.rent_amount if lease_obj else 0.0,
        deposit_amount=lease_obj.deposit_amount if lease_obj else 0.0,
        utility_deposit=getattr(lease_obj, "utility_deposit", None) if lease_obj else None,
        invoice_day=bs.invoice_day if bs else 5,
        due_days=bs.due_days if bs else 7,
        grace_days=bs.grace_days if bs else 3,
        late_fee_type=bs.late_fee_type if bs else "flat",
        late_fee_value=bs.late_fee_value if bs else 0.0,
        notice_days=ld.notice_days if ld else 30,
        termination_fee_type=ld.termination_fee_type if ld else "none",
        termination_fee_value=ld.termination_fee_value if ld else None,
        deposit_refund_days=pd.deposit_refund_days if pd else 30,
        utilities=utils,
        payment_config=pc_summary,
        notes=getattr(lease_obj, "notes", None) if lease_obj else None,
        signed_at_str=signed_at_str,
        signature_bytes=sig_bytes,
        owner_signature_bytes=owner_sig_bytes,
        owner_signed_at_str=owner_sat_str,
        owner_signed_by=ob.owner_signed_by,
        signer_ip=signer_ip,
        verification_url=f"{settings.app_base_url}/verify/{ob.id}",
    )

    # Derive verification code from the fingerprint embedded in the PDF
    fingerprint_raw = f"{ob.id}|{getattr(lease_obj, 'reference_no', '')}|{tenant_name}|{getattr(lease_obj, 'rent_amount', 0)}|{getattr(lease_obj, 'deposit_amount', 0)}|{getattr(lease_obj, 'start_date', '')}|{getattr(lease_obj, 'end_date', '')}"
    doc_fp = hashlib.sha256(fingerprint_raw.encode()).hexdigest()
    ob.doc_fingerprint = doc_fp
    ob.verification_code = doc_fp[-8:]  # last 8 hex chars — easy to type
    ob.pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # Store PDF in S3 for later download
    try:
        pdf_s3_key = f"{ob.org_id}/onboarding/{ob.id}/lease-agreement.pdf"
        await upload_file(key=pdf_s3_key, body=pdf_bytes, content_type="application/pdf")
        ob.pdf_key = pdf_s3_key
    except Exception:
        pass  # Non-fatal: email still delivers the PDF

    await onboarding_repository.save(ob)

    first_name = ob.first_name or "Tenant"
    ref = getattr(lease_obj, "reference_no", "") if lease_obj else ""
    await send_email(
        to=ob.invite_email,
        subject=f"Your signed lease agreement — {ref}" if ref else "Your signed lease agreement",
        html=lease_signed_pdf_html(first_name, ref, activated),
        attachments=[{"filename": "lease-agreement.pdf", "content": pdf_bytes}],
    )
    return pdf_bytes


def _resolve_payment_config(pc, unit_obj, ob) -> Optional[PaymentConfigSummary]:
    """Resolve account_reference based on the property's payment config type."""
    if not pc:
        return None
    if pc.account_reference_type == "unit_code":
        account_ref = unit_obj.unit_code if unit_obj else None
    elif pc.account_reference_type == "tenant_id":
        account_ref = str(ob.tenant_id) if ob.tenant_id else None
    else:
        account_ref = pc.custom_account_reference
    return PaymentConfigSummary(
        paybill_number=pc.paybill_number,
        till_number=pc.till_number,
        bank_name=pc.bank_name,
        bank_account=pc.bank_account,
        bank_branch=pc.bank_branch,
        online_payment_enabled=pc.online_payment_enabled,
        account_reference=account_ref,
    )


async def _get_by_token_or_404(token: str) -> Onboarding:
    ob = await onboarding_repository.get_by_token(token)
    if not ob:
        raise ResourceNotFoundError("Onboarding", token)
    return ob


async def _upload_doc(ob: Onboarding, file: UploadFile, doc_type: str) -> str:
    ext = (file.filename or "").rsplit(".", 1)[-1] or "jpg"
    key = f"{ob.org_id}/onboarding/{ob.id}/{doc_type}.{ext}"
    content = await file.read()
    await upload_file(key=key, body=content, content_type=file.content_type or "image/jpeg")
    return key


async def _public_response(ob: Onboarding) -> OnboardingPublicResponse:
    """Build the public response, optionally enriched with lease summary and org branding."""
    # Fetch org branding
    org = await org_repository.get_by_org_id(ob.org_id)
    org_biz = org.business if org else None
    org_name    = org_biz.name if org_biz else None
    org_logo_url = org_biz.logo_url if org_biz else None
    org_phone   = org_biz.phone if org_biz else None
    org_email   = org_biz.email if org_biz else None
    org_address = org_biz.address if org_biz else None

    lease_summary: Optional[LeaseSummary] = None
    if ob.lease_id:
        lease = await lease_repository.get_by_id(ob.lease_id, ob.org_id)
        if lease:
            unit = await unit_repository.get_by_id(lease.unit_id, ob.org_id)
            prop = await property_repository.get_by_id(ob.property_id, ob.org_id)

            # Build utility lines: merge property defaults + unit overrides
            utility_lines: list[UtilityContractLine] = []
            std_keys = ("electricity", "water", "gas", "internet", "garbage", "security")
            std_labels = {
                "electricity": "Electricity", "water": "Water", "gas": "Gas",
                "internet": "Internet", "garbage": "Garbage Collection", "security": "Security",
            }
            if prop:
                prop_utils = prop.utility_defaults
                unit_overrides = unit.utility_overrides if unit and hasattr(unit, "utility_overrides") else None
                for key in std_keys:
                    base = getattr(prop_utils, key, None)
                    override = getattr(unit_overrides, key, None) if unit_overrides else None
                    detail = override or base
                    if detail:
                        utility_lines.append(UtilityContractLine(
                            key=key,
                            label=detail.label or std_labels[key],
                            type=detail.type,
                            rate=detail.rate,
                            unit_label=detail.unit,
                            deposit=detail.deposit,
                        ))
                for cu in (prop_utils.custom or []):
                    utility_lines.append(UtilityContractLine(
                        key=cu.key, label=cu.label or cu.key,
                        type=cu.type, rate=cu.rate, unit_label=cu.unit, deposit=cu.deposit,
                    ))

            prop_address: Optional[str] = None
            if prop and prop.address:
                prop_address = ", ".join(p for p in [
                    prop.address.street, prop.address.city, prop.address.state, prop.address.country,
                ] if p)

            bs = prop.billing_settings if prop else None
            ld = prop.lease_defaults if prop else None
            pd = prop.pricing_defaults if prop else None

            payment_config_summary = _resolve_payment_config(
                prop.payment_config if prop else None, unit, ob,
            )

            lease_summary = LeaseSummary(
                lease_id=str(lease.id),
                status=lease.status,
                reference_no=getattr(lease, "reference_no", None),
                unit_code=unit.unit_code if unit else None,
                property_name=prop.name if prop else None,
                property_address=prop_address,
                rent_amount=lease.rent_amount,
                deposit_amount=lease.deposit_amount,
                utility_deposit=lease.utility_deposit,
                start_date=str(lease.start_date) if lease.start_date else None,
                end_date=str(lease.end_date) if lease.end_date else None,
                notes=lease.notes if hasattr(lease, "notes") else None,
                invoice_day=bs.invoice_day if bs else 1,
                due_days=bs.due_days if bs else 7,
                grace_days=bs.grace_days if bs else 3,
                late_fee_type=bs.late_fee_type if bs else "flat",
                late_fee_value=bs.late_fee_value if bs else 0.0,
                notice_days=ld.notice_days if ld else 30,
                termination_fee_type=ld.termination_fee_type if ld else "none",
                termination_fee_value=ld.termination_fee_value if ld else None,
                deposit_refund_days=pd.deposit_refund_days if pd else 30,
                utilities=utility_lines,
                payment_config=payment_config_summary,
            )

    return OnboardingPublicResponse(
        id=str(ob.id),
        status=ob.status,
        invite_email=ob.invite_email,
        first_name=ob.first_name,
        last_name=ob.last_name,
        date_of_birth=ob.date_of_birth,
        phone=ob.phone,
        emergency_contact_name=ob.emergency_contact_name,
        emergency_contact_phone=ob.emergency_contact_phone,
        id_type=ob.id_type,
        id_number=ob.id_number,
        has_id_front=ob.id_front_key is not None,
        has_id_back=ob.id_back_key is not None,
        has_selfie=ob.selfie_key is not None,
        has_signature=ob.signature_key is not None,
        has_owner_signature=ob.owner_signature_key is not None,
        org_name=org_name,
        org_logo_url=org_logo_url,
        org_phone=org_phone,
        org_email=org_email,
        org_address=org_address,
        lease=lease_summary,
    )


async def _to_response(ob: Onboarding) -> OnboardingResponse:
    id_front_url = await generate_presigned_url(ob.id_front_key) if ob.id_front_key else None
    id_back_url = await generate_presigned_url(ob.id_back_key) if ob.id_back_key else None
    selfie_url = await generate_presigned_url(ob.selfie_key) if ob.selfie_key else None

    invite_link = (
        f"{settings.app_base_url}/onboarding/{ob.invite_token}"
        if ob.invite_token else None
    )

    return OnboardingResponse(
        id=str(ob.id),
        org_id=ob.org_id,
        property_id=ob.property_id,
        unit_id=ob.unit_id,
        tenant_id=ob.tenant_id,
        lease_id=ob.lease_id,
        status=ob.status,
        initiated_by=ob.initiated_by,
        notes=ob.notes,
        invite_email=ob.invite_email,
        invite_sent_at=ob.invite_sent_at,
        invite_link=invite_link,
        id_type=ob.id_type,
        id_number=ob.id_number,
        id_front_url=id_front_url,
        id_back_url=id_back_url,
        selfie_url=selfie_url,
        first_name=ob.first_name,
        last_name=ob.last_name,
        date_of_birth=ob.date_of_birth,
        phone=ob.phone,
        emergency_contact_name=ob.emergency_contact_name,
        emergency_contact_phone=ob.emergency_contact_phone,
        created_at=ob.created_at,
        updated_at=ob.updated_at,
    )
