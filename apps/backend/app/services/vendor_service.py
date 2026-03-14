"""Admin-side vendor management business logic."""
import secrets
from typing import Dict, List, Optional, Tuple

import structlog

from app.core.config import settings
from app.core.email import (
    send_email,
    vendor_approved_html,
    vendor_rejected_html,
    vendor_setup_html,
    vendor_contract_sent_html,
)
from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.dependencies.auth import CurrentUser
from app.models.vendor_application import VendorApplication
from app.models.vendor_contract import ContractSignature, VendorContract
from app.models.vendor_listing import VendorListing
from app.models.vendor_profile import VendorAuditEntry, VendorRating, VendorProfile
from app.repositories.user_repository import user_repository
from app.repositories.vendor_repository import (
    vendor_application_repository,
    vendor_contract_repository,
    vendor_listing_repository,
    vendor_profile_repository,
)
from app.schemas.vendor import (
    VendorApplicationRejectRequest,
    VendorContractCreateRequest,
    VendorCreateRequest,
    VendorListingCreateRequest,
    VendorListingUpdateRequest,
    VendorRatingIn,
    VendorUpdateRequest,
)
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _profile_to_dict(profile: VendorProfile) -> dict:
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


def _listing_to_dict(listing: VendorListing) -> dict:
    return {
        "id": str(listing.id),
        "org_id": listing.org_id,
        "title": listing.title,
        "description": listing.description,
        "service_category": listing.service_category,
        "requirements": listing.requirements,
        "application_fee": listing.application_fee,
        "contract_template": listing.contract_template,
        "contract_duration_months": listing.contract_duration_months,
        "contract_value": listing.contract_value,
        "deadline": listing.deadline,
        "max_vendors": listing.max_vendors,
        "status": listing.status,
        "published_at": listing.published_at,
        "created_at": listing.created_at,
        "updated_at": listing.updated_at,
    }


def _application_to_dict(app: VendorApplication) -> dict:
    return {
        "id": str(app.id),
        "org_id": app.org_id,
        "listing_id": app.listing_id,
        "company_name": app.company_name,
        "contact_name": app.contact_name,
        "contact_email": app.contact_email,
        "contact_phone": app.contact_phone,
        "registration_number": app.registration_number,
        "tax_pin": app.tax_pin,
        "service_categories": app.service_categories,
        "cover_letter": app.cover_letter,
        "fee_paid": app.fee_paid,
        "fee_amount": app.fee_amount,
        "status": app.status,
        "reviewed_by": app.reviewed_by,
        "reviewed_at": app.reviewed_at,
        "rejection_reason": app.rejection_reason,
        "vendor_profile_id": app.vendor_profile_id,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
    }


def _contract_to_dict(c: VendorContract) -> dict:
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


# ── Vendor Profile (admin) ────────────────────────────────────────────────────

async def create_vendor(request: VendorCreateRequest, current_user: CurrentUser) -> dict:
    """Create vendor profile + generate setup link + send email."""
    # Check no existing profile with same email in org
    org_id = current_user.org_id

    profile = VendorProfile(
        org_id=org_id,
        status="approved",
        company_name=request.company_name,
        trading_name=request.trading_name,
        registration_number=request.registration_number,
        tax_pin=request.tax_pin,
        company_type=request.company_type,
        contact_name=request.contact_name,
        contact_email=request.contact_email,
        contact_phone=request.contact_phone,
        website=request.website,
        address=request.address,
        service_areas=request.service_areas,
        service_categories=request.service_categories,
        notes=request.notes,
        created_by=current_user.user_id,
        setup_link_token=secrets.token_urlsafe(32),
    )
    profile.audit_trail.append(
        VendorAuditEntry(
            action="created",
            actor_id=current_user.user_id,
            description="Vendor profile created by admin",
        )
    )
    await vendor_profile_repository.create(profile)

    setup_url = f"{settings.app_base_url}/vendor-setup/{profile.setup_link_token}"
    await send_email(
        to=request.contact_email,
        subject="Set up your vendor account",
        html=vendor_setup_html(request.contact_name, setup_url, "your organisation"),
    )

    logger.info(
        "vendor_created",
        action="create_vendor",
        resource_type="vendor_profile",
        resource_id=str(profile.id),
        org_id=org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _profile_to_dict(profile)


async def list_vendors(
    org_id: str,
    status: Optional[str],
    category: Optional[str],
    search: Optional[str],
    page: int,
    page_size: int,
) -> Tuple[List[dict], int]:
    items, total = await vendor_profile_repository.list(
        org_id=org_id,
        status=status,
        category=category,
        search=search,
        page=page,
        page_size=page_size,
    )
    return [_profile_to_dict(p) for p in items], total


async def get_vendor_counts(org_id: str) -> Dict[str, int]:
    return await vendor_profile_repository.counts(org_id)


async def get_vendor(vendor_id: str, current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")
    return _profile_to_dict(profile)


async def update_vendor(
    vendor_id: str, request: VendorUpdateRequest, current_user: CurrentUser
) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")

    for field, val in request.model_dump(exclude_none=True).items():
        if field == "services":
            from app.models.vendor_profile import VendorServiceOffering
            profile.services = [VendorServiceOffering(**s) for s in val]
        elif field == "team_members":
            from app.models.vendor_profile import VendorTeamMember
            profile.team_members = [VendorTeamMember(**m) for m in val]
        else:
            setattr(profile, field, val)

    profile.audit_trail.append(
        VendorAuditEntry(
            action="updated",
            actor_id=current_user.user_id,
            description="Profile updated by admin",
        )
    )
    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


async def delete_vendor(vendor_id: str, current_user: CurrentUser) -> None:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")
    await vendor_profile_repository.soft_delete(profile)


async def approve_vendor(vendor_id: str, current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")

    profile.status = "approved"
    if not profile.setup_link_token:
        profile.setup_link_token = secrets.token_urlsafe(32)
    profile.audit_trail.append(
        VendorAuditEntry(
            action="approved",
            actor_id=current_user.user_id,
            description="Vendor approved by admin",
        )
    )
    await vendor_profile_repository.update(profile)

    setup_url = f"{settings.app_base_url}/vendor-setup/{profile.setup_link_token}"
    await send_email(
        to=profile.contact_email,
        subject="Your vendor account has been approved",
        html=vendor_setup_html(profile.contact_name, setup_url, "your organisation"),
    )
    return _profile_to_dict(profile)


async def suspend_vendor(vendor_id: str, reason: Optional[str], current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")
    profile.status = "suspended"
    profile.audit_trail.append(
        VendorAuditEntry(
            action="suspended",
            actor_id=current_user.user_id,
            description=f"Suspended: {reason or 'no reason given'}",
        )
    )
    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


async def send_invite(vendor_id: str, current_user: CurrentUser) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")

    profile.invite_token = secrets.token_urlsafe(32)
    profile.audit_trail.append(
        VendorAuditEntry(
            action="invite_sent",
            actor_id=current_user.user_id,
            description="Onboarding invite (re)sent",
        )
    )
    await vendor_profile_repository.update(profile)

    invite_url = f"{settings.app_base_url}/vendor-onboarding/{profile.invite_token}"
    await send_email(
        to=profile.contact_email,
        subject="Complete your vendor onboarding",
        html=vendor_approved_html(profile.contact_name, invite_url, "your organisation"),
    )
    return _profile_to_dict(profile)


async def create_contract(
    vendor_id: str,
    request: VendorContractCreateRequest,
    current_user: CurrentUser,
) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")

    vendor_token = secrets.token_urlsafe(32)
    contract = VendorContract(
        org_id=current_user.org_id,
        vendor_profile_id=str(profile.id),
        title=request.title,
        content=request.content,
        start_date=request.start_date,
        end_date=request.end_date,
        auto_renew=request.auto_renew,
        renewal_notice_days=request.renewal_notice_days,
        contract_fee=request.contract_fee,
        status="sent",
        vendor_token=vendor_token,
        sent_at=utc_now(),
        created_by=current_user.user_id,
    )
    await vendor_contract_repository.create(contract)

    # Update profile
    profile.active_contract_id = str(contract.id)
    await vendor_profile_repository.update(profile)

    contract_url = f"{settings.app_base_url}/vendor-contract/{vendor_token}"
    await send_email(
        to=profile.contact_email,
        subject=f"Contract to review: {request.title}",
        html=vendor_contract_sent_html(
            profile.contact_name, contract_url, request.title, "your organisation"
        ),
    )
    return _contract_to_dict(contract)


async def add_rating(
    vendor_id: str, request: VendorRatingIn, current_user: CurrentUser
) -> dict:
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise ResourceNotFoundError("Vendor")

    rating = VendorRating(
        rated_by=current_user.user_id,
        stars=request.stars,
        review=request.review,
        ticket_id=request.ticket_id,
    )
    profile.ratings.append(rating)

    # Recompute avg
    stars_list = [r.stars for r in profile.ratings]
    profile.rating_avg = sum(stars_list) / len(stars_list)
    profile.rating_count = len(stars_list)

    await vendor_profile_repository.update(profile)
    return _profile_to_dict(profile)


# ── Vendor Listing (admin) ────────────────────────────────────────────────────

async def create_listing(
    request: VendorListingCreateRequest, current_user: CurrentUser
) -> dict:
    listing = VendorListing(
        org_id=current_user.org_id,
        title=request.title,
        description=request.description,
        service_category=request.service_category,
        requirements=request.requirements,
        application_fee=request.application_fee,
        contract_template=request.contract_template,
        contract_duration_months=request.contract_duration_months,
        contract_value=request.contract_value,
        deadline=request.deadline,
        max_vendors=request.max_vendors,
        status="draft",
        created_by=current_user.user_id,
    )
    await vendor_listing_repository.create(listing)
    return _listing_to_dict(listing)


async def list_listings(
    org_id: str,
    status: Optional[str],
    page: int,
    page_size: int,
) -> Tuple[List[dict], int]:
    items, total = await vendor_listing_repository.list(
        org_id=org_id, status=status, page=page, page_size=page_size
    )
    return [_listing_to_dict(l) for l in items], total


async def get_listing(listing_id: str, current_user: CurrentUser) -> dict:
    listing = await vendor_listing_repository.get_by_id(listing_id, current_user.org_id)
    if not listing:
        raise ResourceNotFoundError("Listing")
    return _listing_to_dict(listing)


async def update_listing(
    listing_id: str, request: VendorListingUpdateRequest, current_user: CurrentUser
) -> dict:
    listing = await vendor_listing_repository.get_by_id(listing_id, current_user.org_id)
    if not listing:
        raise ResourceNotFoundError("Listing")
    for field, val in request.model_dump(exclude_none=True).items():
        setattr(listing, field, val)
    await vendor_listing_repository.update(listing)
    return _listing_to_dict(listing)


async def delete_listing(listing_id: str, current_user: CurrentUser) -> None:
    listing = await vendor_listing_repository.get_by_id(listing_id, current_user.org_id)
    if not listing:
        raise ResourceNotFoundError("Listing")
    await vendor_listing_repository.soft_delete(listing)


async def publish_listing(listing_id: str, current_user: CurrentUser) -> dict:
    listing = await vendor_listing_repository.get_by_id(listing_id, current_user.org_id)
    if not listing:
        raise ResourceNotFoundError("Listing")
    listing.status = "open"
    listing.published_at = utc_now()
    await vendor_listing_repository.update(listing)
    return _listing_to_dict(listing)


# ── Vendor Application (admin) ────────────────────────────────────────────────

async def list_applications(
    org_id: str,
    listing_id: Optional[str],
    status: Optional[str],
    page: int,
    page_size: int,
) -> Tuple[List[dict], int]:
    items, total = await vendor_application_repository.list(
        org_id=org_id, listing_id=listing_id, status=status, page=page, page_size=page_size
    )
    return [_application_to_dict(a) for a in items], total


async def get_application(application_id: str, current_user: CurrentUser) -> dict:
    app = await vendor_application_repository.get_by_id(application_id, current_user.org_id)
    if not app:
        raise ResourceNotFoundError("Application")
    return _application_to_dict(app)


async def approve_application(application_id: str, current_user: CurrentUser) -> dict:
    app = await vendor_application_repository.get_by_id(application_id, current_user.org_id)
    if not app:
        raise ResourceNotFoundError("Application")
    if app.status != "submitted" and app.status != "under_review":
        raise ConflictError(f"Application is in status '{app.status}', cannot approve")

    invite_token = secrets.token_urlsafe(32)
    profile = VendorProfile(
        org_id=current_user.org_id,
        status="approved",
        company_name=app.company_name,
        contact_name=app.contact_name,
        contact_email=app.contact_email,
        contact_phone=app.contact_phone,
        registration_number=app.registration_number,
        tax_pin=app.tax_pin,
        service_categories=app.service_categories,
        invite_token=invite_token,
        created_by=current_user.user_id,
    )
    profile.audit_trail.append(
        VendorAuditEntry(
            action="created_from_application",
            actor_id=current_user.user_id,
            description=f"Created from application {application_id}",
        )
    )
    await vendor_profile_repository.create(profile)

    app.status = "approved"
    app.reviewed_by = current_user.user_id
    app.reviewed_at = utc_now()
    app.vendor_profile_id = str(profile.id)
    await vendor_application_repository.update(app)

    invite_url = f"{settings.app_base_url}/vendor-onboarding/{invite_token}"
    await send_email(
        to=app.contact_email,
        subject="Your vendor application has been approved",
        html=vendor_approved_html(app.contact_name, invite_url, "your organisation"),
    )
    return _application_to_dict(app)


async def reject_application(
    application_id: str,
    request: VendorApplicationRejectRequest,
    current_user: CurrentUser,
) -> dict:
    app = await vendor_application_repository.get_by_id(application_id, current_user.org_id)
    if not app:
        raise ResourceNotFoundError("Application")

    app.status = "rejected"
    app.reviewed_by = current_user.user_id
    app.reviewed_at = utc_now()
    app.rejection_reason = request.rejection_reason
    await vendor_application_repository.update(app)

    await send_email(
        to=app.contact_email,
        subject="Your vendor application status",
        html=vendor_rejected_html(app.contact_name, request.rejection_reason, "your organisation"),
    )
    return _application_to_dict(app)
