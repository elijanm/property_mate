"""Admin + public vendor management endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form, status

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.vendor import (
    VendorApplicationListResponse,
    VendorApplicationRejectRequest,
    VendorApplicationResponse,
    VendorContractCreateRequest,
    VendorContractResponse,
    VendorCountsResponse,
    VendorCreateRequest,
    VendorListingCreateRequest,
    VendorListingListResponse,
    VendorListingResponse,
    VendorListingUpdateRequest,
    VendorProfileListResponse,
    VendorProfileResponse,
    VendorRatingIn,
    VendorUpdateRequest,
    SuspendRequest,
)
from app.services import vendor_service

router = APIRouter(prefix="/vendors", tags=["vendors"])
listings_router = APIRouter(prefix="/vendor-listings", tags=["vendor-listings"])
applications_router = APIRouter(prefix="/vendor-applications", tags=["vendor-applications"])


# ── Vendor Profiles ───────────────────────────────────────────────────────────

@router.post("", response_model=VendorProfileResponse)
async def create_vendor(
    request: VendorCreateRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.create_vendor(request, current_user)


@router.get("", response_model=VendorProfileListResponse)
async def list_vendors(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    items, total = await vendor_service.list_vendors(
        org_id=current_user.org_id,
        status=status,
        category=category,
        search=search,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/counts", response_model=VendorCountsResponse)
async def vendor_counts(
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.get_vendor_counts(current_user.org_id)


@router.get("/{vendor_id}", response_model=VendorProfileResponse)
async def get_vendor(
    vendor_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.get_vendor(vendor_id, current_user)


@router.patch("/{vendor_id}", response_model=VendorProfileResponse)
async def update_vendor(
    vendor_id: str,
    request: VendorUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.update_vendor(vendor_id, request, current_user)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    await vendor_service.delete_vendor(vendor_id, current_user)


@router.post("/{vendor_id}/approve", response_model=VendorProfileResponse)
async def approve_vendor(
    vendor_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    return await vendor_service.approve_vendor(vendor_id, current_user)


@router.post("/{vendor_id}/suspend", response_model=VendorProfileResponse)
async def suspend_vendor(
    vendor_id: str,
    request: SuspendRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    return await vendor_service.suspend_vendor(vendor_id, request.reason, current_user)


@router.post("/{vendor_id}/send-invite", response_model=VendorProfileResponse)
async def send_invite(
    vendor_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.send_invite(vendor_id, current_user)


@router.post("/{vendor_id}/contracts", response_model=VendorContractResponse)
async def create_contract(
    vendor_id: str,
    request: VendorContractCreateRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.create_contract(vendor_id, request, current_user)


@router.post("/{vendor_id}/rate", response_model=VendorProfileResponse)
async def add_rating(
    vendor_id: str,
    request: VendorRatingIn,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.add_rating(vendor_id, request, current_user)


@router.get("/{vendor_id}/tickets")
async def get_vendor_tickets(
    vendor_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    from app.repositories.vendor_repository import vendor_profile_repository
    from app.repositories.ticket_repository import ticket_repository
    profile = await vendor_profile_repository.get_by_id(vendor_id, current_user.org_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if not profile.user_id:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}
    items, total = await ticket_repository.list(
        org_id=current_user.org_id,
        assigned_to=profile.user_id,
        page=page,
        page_size=page_size,
    )
    return {
        "items": [
            {
                "id": str(t.id),
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "category": t.category,
                "property_id": t.property_id,
                "created_at": t.created_at,
            }
            for t in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── Vendor Listings ───────────────────────────────────────────────────────────

@listings_router.post("", response_model=VendorListingResponse)
async def create_listing(
    request: VendorListingCreateRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.create_listing(request, current_user)


@listings_router.get("", response_model=VendorListingListResponse)
async def list_listings(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    items, total = await vendor_service.list_listings(
        current_user.org_id, status=status, page=page, page_size=page_size
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@listings_router.get("/{listing_id}", response_model=VendorListingResponse)
async def get_listing(
    listing_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.get_listing(listing_id, current_user)


@listings_router.patch("/{listing_id}", response_model=VendorListingResponse)
async def update_listing(
    listing_id: str,
    request: VendorListingUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.update_listing(listing_id, request, current_user)


@listings_router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_listing(
    listing_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    await vendor_service.delete_listing(listing_id, current_user)


@listings_router.post("/{listing_id}/publish", response_model=VendorListingResponse)
async def publish_listing(
    listing_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.publish_listing(listing_id, current_user)


# ── Vendor Applications ───────────────────────────────────────────────────────

@applications_router.get("", response_model=VendorApplicationListResponse)
async def list_applications(
    listing_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    items, total = await vendor_service.list_applications(
        current_user.org_id,
        listing_id=listing_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@applications_router.get("/{application_id}", response_model=VendorApplicationResponse)
async def get_application(
    application_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
):
    return await vendor_service.get_application(application_id, current_user)


@applications_router.post("/{application_id}/approve", response_model=VendorApplicationResponse)
async def approve_application(
    application_id: str,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    return await vendor_service.approve_application(application_id, current_user)


@applications_router.post("/{application_id}/reject", response_model=VendorApplicationResponse)
async def reject_application(
    application_id: str,
    request: VendorApplicationRejectRequest,
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
):
    return await vendor_service.reject_application(application_id, request, current_user)
