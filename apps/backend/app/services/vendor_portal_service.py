"""Vendor-facing portal business logic — public flows + authenticated portal."""
import base64
import secrets
from typing import List, Optional, Tuple

import structlog

from app.core.config import settings
from app.core.email import send_email, vendor_contract_sent_html, vendor_setup_html
from app.core.exceptions import ConflictError, ResourceNotFoundError, UnauthorizedError
from app.core.s3 import upload_file, generate_presigned_url
from app.dependencies.auth import CurrentUser
from app.models.vendor_application import VendorApplication
from app.models.vendor_contract import ContractSignature
from app.models.vendor_profile import VendorAuditEntry, VendorDocument, VendorServiceOffering
from app.models.user import User
from app.repositories.user_repository import user_repository
from app.repositories.vendor_repository import (
    vendor_application_repository,
    vendor_contract_repository,
    vendor_listing_repository,
    vendor_profile_repository,
)
from app.schemas.vendor import (
    VendorApplicationCreateRequest,
    VendorCompanyDetailsRequest,
    VendorContractSignRequest,
    VendorServicesRequest,
    VendorActivateRequest,
    VendorUpdateRequest,
)
from app.services.auth_service import create_access_token, hash_password
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _profile_to_dict(profile) -> dict:
    return {
        "id": str(profile.id),
        "org_id": profile.org_id,
        "user_id": profile.user_id,
        "status": profile.status,
        "verification_status": profile.verification_status,
        "company_name": profile.company_name,
        "trading_name": profile.trading_name,
        "registration_number": profile.registration_number,
        "tax_pin": profile.tax_pin,
        "company_type": profile.company_type,
        "contact_name": profile.contact_name,
        "contact_email": profile.contact_email,
        "contact_phone": profile.contact_phone,
        "website": profile.website,
        "address": profile.address,
        "service_areas": profile.service_areas,
        "service_categories": profile.service_categories,
        "active_contract_id": profile.active_contract_id,
        "rating_avg": profile.rating_avg,
        "rating_count": profile.rating_count,
        "notes": profile.notes,
        "onboarding_completed_at": profile.onboarding_completed_at,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    }


def _contract_to_dict(c) -> dict:
    def _sig(sig):
        if not sig:
            return None
        return {
            "signed_by": sig.signed_by,
            "signed_by_name": sig.signed_by_name,
            "signed_at": sig.signed_at,
            "ip_address": sig.ip_address,
        }

    return {
        "id": str(c.id),
        "org_id": c.org_id,
        "vendor_profile_id": c.vendor_profile_id,
        "listing_id": c.listing_id,
        "title": c.title,
        "content": c.content,
        "start_date": c.start_date,
        "end_date": c.end_date,
        "auto_renew": c.auto_renew,
        "renewal_notice_days": c.renewal_notice_days,
        "contract_fee": c.contract_fee,
        "fee_paid": c.fee_paid,
        "status": c.status,
        "vendor_signature": _sig(c.vendor_signature),
        "org_signature": _sig(c.org_signature),
        "sent_at": c.sent_at,
        "activated_at": c.activated_at,
        "terminated_at": c.terminated_at,
        "termination_reason": c.termination_reason,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }


# ── Public: listing directory + apply ────────────────────────────────────────

async def get_public_listings_directory(org_id: str) -> dict:
    """Return org branding + all open listings for the public directory page."""
    from app.repositories.org_repository import org_repository
    org = await org_repository.get_by_org_id(org_id)
    if not org:
        raise ResourceNotFoundError("Organisation")

    listings = await vendor_listing_repository.list_open_by_org(org_id)

    def _listing_dict(l) -> dict:
        return {
            "id": str(l.id),
            "org_id": l.org_id,
            "title": l.title,
            "description": l.description,
            "service_category": l.service_category,
            "requirements": l.requirements,
            "application_fee": l.application_fee,
            "contract_duration_months": l.contract_duration_months,
            "contract_value": l.contract_value,
            "deadline": l.deadline,
            "max_vendors": l.max_vendors,
            "status": l.status,
            "published_at": getattr(l, "published_at", None),
            "created_at": l.created_at,
            "updated_at": l.updated_at,
        }

    return {
        "org": {
            "org_id": org_id,
            "name": getattr(org.business, "name", None),
            "logo_url": getattr(org.business, "logo_url", None),
            "email": getattr(org.business, "email", None),
            "phone": getattr(org.business, "phone", None),
            "website": getattr(org.business, "website", None),
            "address": getattr(org.business, "address", None),
        },
        "listings": [_listing_dict(l) for l in listings],
    }


async def get_public_listing(listing_id: str) -> dict:
    listing = await vendor_listing_repository.get_by_id_no_org(listing_id)
    if not listing or listing.status != "open":
        raise ResourceNotFoundError("Listing")
    return {
        "id": str(listing.id),
        "org_id": listing.org_id,
        "title": listing.title,
        "description": listing.description,
        "service_category": listing.service_category,
        "requirements": listing.requirements,
        "application_fee": listing.application_fee,
        "contract_duration_months": listing.contract_duration_months,
        "contract_value": listing.contract_value,
        "deadline": listing.deadline,
        "max_vendors": listing.max_vendors,
        "status": listing.status,
    }


async def submit_application(listing_id: str, request: VendorApplicationCreateRequest) -> dict:
    listing = await vendor_listing_repository.get_by_id_no_org(listing_id)
    if not listing or listing.status != "open":
        raise ResourceNotFoundError("Listing")

    from app.core.email import vendor_application_received_html
    app = VendorApplication(
        org_id=listing.org_id,
        listing_id=listing_id,
        company_name=request.company_name,
        contact_name=request.contact_name,
        contact_email=request.contact_email,
        contact_phone=request.contact_phone,
        registration_number=request.registration_number,
        tax_pin=request.tax_pin,
        service_categories=request.service_categories,
        cover_letter=request.cover_letter,
        fee_amount=listing.application_fee,
        status="submitted",
    )
    await vendor_application_repository.create(app)

    await send_email(
        to=request.contact_email,
        subject=f"Application received: {listing.title}",
        html=vendor_application_received_html(
            request.company_name, listing.title, "the organisation"
        ),
    )
    return {"id": str(app.id), "status": app.status, "application_token": app.application_token}


# ── Public: onboarding wizard ─────────────────────────────────────────────────

async def get_onboarding_context(token: str) -> dict:
    profile = await vendor_profile_repository.get_by_invite_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")
    return {
        "vendor_profile_id": str(profile.id),
        "company_name": profile.company_name,
        "contact_name": profile.contact_name,
        "contact_email": profile.contact_email,
        "status": profile.status,
        "onboarding_completed_at": profile.onboarding_completed_at,
    }


async def save_company_details(token: str, request: VendorCompanyDetailsRequest) -> dict:
    profile = await vendor_profile_repository.get_by_invite_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")

    for field, val in request.model_dump(exclude_none=True).items():
        setattr(profile, field, val)

    profile.audit_trail.append(
        VendorAuditEntry(action="company_details_saved", description="Company details step completed")
    )
    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


async def save_services(token: str, request: VendorServicesRequest) -> dict:
    profile = await vendor_profile_repository.get_by_invite_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")

    profile.service_categories = request.service_categories
    profile.services = [
        VendorServiceOffering(**s.model_dump()) for s in request.services
    ]
    profile.audit_trail.append(
        VendorAuditEntry(action="services_saved", description="Services step completed")
    )
    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


async def upload_document(
    token: str, doc_type: str, name: str, file_bytes: bytes, content_type: str
) -> dict:
    profile = await vendor_profile_repository.get_by_invite_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")

    import uuid as _uuid
    file_id = str(_uuid.uuid4())
    s3_key = f"{profile.org_id}/vendor_docs/{str(profile.id)}/{file_id}_{name}"
    await upload_file(s3_key, file_bytes, content_type)

    doc = VendorDocument(
        doc_type=doc_type,
        name=name,
        s3_key=s3_key,
    )
    profile.documents.append(doc)
    profile.audit_trail.append(
        VendorAuditEntry(action="document_uploaded", description=f"Document '{name}' uploaded")
    )
    await vendor_profile_repository.update(profile)
    return {"id": doc.id, "doc_type": doc.doc_type, "name": doc.name, "s3_key": s3_key}


async def complete_onboarding(token: str) -> dict:
    profile = await vendor_profile_repository.get_by_invite_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")

    profile.onboarding_completed_at = utc_now()
    profile.audit_trail.append(
        VendorAuditEntry(action="onboarding_completed", description="Vendor completed onboarding wizard")
    )

    # Check if there's a listing with a contract template
    created_contract = None
    listing = None
    if profile.active_contract_id is None:
        # Try to find an associated listing via application
        app = await VendorApplication.find_one(
            VendorApplication.vendor_profile_id == str(profile.id),
            VendorApplication.deleted_at == None,  # noqa: E711
        )
        if app and app.listing_id:
            listing = await vendor_listing_repository.get_by_id_no_org(app.listing_id)

    if listing and listing.contract_template:
        from app.models.vendor_contract import VendorContract
        from datetime import date, timedelta

        dur = listing.contract_duration_months or 12
        start = date.today()
        from dateutil.relativedelta import relativedelta
        end = start + relativedelta(months=dur)

        vendor_token = secrets.token_urlsafe(32)
        contract = VendorContract(
            org_id=profile.org_id,
            vendor_profile_id=str(profile.id),
            listing_id=listing.active_contract_id if hasattr(listing, "active_contract_id") else None,
            title=f"Vendor Contract - {profile.company_name}",
            content=listing.contract_template,
            start_date=start,
            end_date=end,
            status="sent",
            vendor_token=vendor_token,
            sent_at=utc_now(),
            created_by="system",
        )
        await vendor_contract_repository.create(contract)
        profile.active_contract_id = str(contract.id)

        contract_url = f"{settings.app_base_url}/vendor-contract/{vendor_token}"
        await send_email(
            to=profile.contact_email,
            subject=f"Contract to review: {contract.title}",
            html=vendor_contract_sent_html(
                profile.contact_name, contract_url, contract.title, "your organisation"
            ),
        )
    else:
        # No contract → send setup link directly
        if not profile.setup_link_token:
            profile.setup_link_token = secrets.token_urlsafe(32)
        setup_url = f"{settings.app_base_url}/vendor-setup/{profile.setup_link_token}"
        await send_email(
            to=profile.contact_email,
            subject="Set up your vendor account",
            html=vendor_setup_html(profile.contact_name, setup_url, "your organisation"),
        )

    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


# ── Public: contract signing ──────────────────────────────────────────────────

async def get_contract_view(token: str) -> dict:
    contract = await vendor_contract_repository.get_by_vendor_token(token)
    if not contract:
        raise ResourceNotFoundError("Contract")
    profile = await vendor_profile_repository.get_by_id_no_org(contract.vendor_profile_id)

    def _sig(sig):
        if not sig:
            return None
        return {
            "signed_by": sig.signed_by,
            "signed_by_name": sig.signed_by_name,
            "signed_at": sig.signed_at,
            "ip_address": sig.ip_address,
        }

    return {
        "id": str(contract.id),
        "title": contract.title,
        "content": contract.content,
        "status": contract.status,
        "vendor_profile_id": contract.vendor_profile_id,
        "company_name": profile.company_name if profile else "",
        "start_date": contract.start_date,
        "end_date": contract.end_date,
        "vendor_signature": _sig(contract.vendor_signature),
    }


async def sign_contract(token: str, request: VendorContractSignRequest, ip: str) -> dict:
    contract = await vendor_contract_repository.get_by_vendor_token(token)
    if not contract:
        raise ResourceNotFoundError("Contract")
    if contract.status not in ("sent", "draft"):
        raise ConflictError(f"Contract cannot be signed in status '{contract.status}'")

    # Upload signature PNG
    sig_bytes = base64.b64decode(request.signature_base64)
    sig_key = f"{contract.org_id}/vendor_signatures/{str(contract.id)}/vendor_sig.png"
    await upload_file(sig_key, sig_bytes, "image/png")

    contract.vendor_signature = ContractSignature(
        signed_by="vendor",
        signed_by_name=request.signer_name,
        signed_at=utc_now(),
        ip_address=ip,
        signature_key=sig_key,
    )
    contract.status = "vendor_signed"
    await vendor_contract_repository.update(contract)

    # Generate setup link for the vendor
    profile = await vendor_profile_repository.get_by_id_no_org(contract.vendor_profile_id)
    if profile and not profile.setup_link_token:
        profile.setup_link_token = secrets.token_urlsafe(32)
        profile.audit_trail.append(
            VendorAuditEntry(action="contract_signed", description="Vendor signed the contract")
        )
        await vendor_profile_repository.update(profile)

        setup_url = f"{settings.app_base_url}/vendor-setup/{profile.setup_link_token}"
        await send_email(
            to=profile.contact_email,
            subject="Set up your vendor account",
            html=vendor_setup_html(profile.contact_name, setup_url, "your organisation"),
        )

    return _contract_to_dict(contract)


# ── Public: account setup ─────────────────────────────────────────────────────

async def get_setup_context(token: str) -> dict:
    profile = await vendor_profile_repository.get_by_setup_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")
    return {
        "company_name": profile.company_name,
        "contact_name": profile.contact_name,
        "contact_email": profile.contact_email,
    }


async def activate_account(token: str, request: VendorActivateRequest) -> dict:
    profile = await vendor_profile_repository.get_by_setup_token(token)
    if not profile:
        raise ResourceNotFoundError("Invalid")
    if profile.user_id:
        raise ConflictError("Account already activated")

    # Check if email taken
    existing = await user_repository.get_by_email(profile.contact_email)
    if existing:
        raise ConflictError("Email already in use")

    user = User(
        email=profile.contact_email,
        hashed_password=hash_password(request.password),
        org_id=profile.org_id,
        role="service_provider",
        first_name=profile.contact_name.split()[0] if profile.contact_name else "",
        last_name=" ".join(profile.contact_name.split()[1:]) if profile.contact_name else "",
        is_active=True,
    )
    await user_repository.create(user)

    profile.user_id = str(user.id)
    profile.setup_link_token = None  # consume the token
    profile.audit_trail.append(
        VendorAuditEntry(
            action="account_activated",
            actor_id=str(user.id),
            description="Vendor activated their account",
        )
    )
    await vendor_profile_repository.update(profile)

    access_token = create_access_token(str(user.id), profile.org_id, "service_provider")
    return {
        "token": access_token,
        "user_id": str(user.id),
        "org_id": profile.org_id,
        "role": "service_provider",
        "email": profile.contact_email,
    }


# ── Vendor Portal (authenticated service_provider) ────────────────────────────

async def get_portal_dashboard(current_user: CurrentUser) -> dict:
    from app.models.ticket import Ticket
    profile = await vendor_profile_repository.get_by_user_id(
        current_user.user_id, current_user.org_id
    )
    if not profile:
        raise ResourceNotFoundError("Vendor")

    open_tickets = await Ticket.find(
        Ticket.org_id == current_user.org_id,
        Ticket.assigned_to == current_user.user_id,
        Ticket.status.in_(["open", "assigned", "in_progress"]),
        Ticket.deleted_at == None,  # noqa: E711
    ).count()

    active_contracts = await vendor_contract_repository.count_active(
        str(profile.id), current_user.org_id
    )

    pending_docs = len([d for d in profile.documents if not d.verified])

    return {
        "open_tickets": open_tickets,
        "active_contracts": active_contracts,
        "pending_documents": pending_docs,
        "total_ratings": profile.rating_count,
        "rating_avg": profile.rating_avg,
    }


async def get_own_profile(current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_user_id(
        current_user.user_id, current_user.org_id
    )
    if not profile:
        raise ResourceNotFoundError("Vendor")
    return _profile_to_dict(profile)


async def update_own_profile(request: VendorUpdateRequest, current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_user_id(
        current_user.user_id, current_user.org_id
    )
    if not profile:
        raise ResourceNotFoundError("Vendor")

    # Only allow non-admin fields
    allowed = {
        "contact_phone", "website", "address", "service_areas",
        "service_categories", "services", "team_members",
    }
    for field, val in request.model_dump(exclude_none=True).items():
        if field not in allowed:
            continue
        if field == "services":
            profile.services = [VendorServiceOffering(**s) for s in val]
        elif field == "team_members":
            from app.models.vendor_profile import VendorTeamMember
            profile.team_members = [VendorTeamMember(**m) for m in val]
        else:
            setattr(profile, field, val)

    profile.audit_trail.append(
        VendorAuditEntry(
            action="profile_updated",
            actor_id=current_user.user_id,
            description="Vendor updated own profile",
        )
    )
    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


async def get_own_contracts(current_user: CurrentUser, page: int, page_size: int) -> Tuple[List[dict], int]:
    profile = await vendor_profile_repository.get_by_user_id(
        current_user.user_id, current_user.org_id
    )
    if not profile:
        raise ResourceNotFoundError("Vendor")
    items, total = await vendor_contract_repository.list_for_vendor(
        str(profile.id), current_user.org_id, page=page, page_size=page_size
    )
    return [_contract_to_dict(c) for c in items], total


async def get_own_contract(contract_id: str, current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_user_id(
        current_user.user_id, current_user.org_id
    )
    if not profile:
        raise ResourceNotFoundError("Vendor")
    contract = await vendor_contract_repository.get_by_id(contract_id, current_user.org_id)
    if not contract or contract.vendor_profile_id != str(profile.id):
        raise ResourceNotFoundError("Contract")
    return _contract_to_dict(contract)
