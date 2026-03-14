"""Public onboarding + vendor portal (service_provider role) endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status

from app.dependencies.auth import CurrentUser, require_roles
from app.schemas.vendor import (
    VendorActivateRequest,
    VendorActivateResponse,
    VendorApplicationCreateRequest,
    VendorCompanyDetailsRequest,
    VendorContractListResponse,
    VendorContractResponse,
    VendorContractSignRequest,
    VendorContractViewResponse,
    VendorOnboardingContextResponse,
    VendorPortalDashboardResponse,
    VendorProfileResponse,
    VendorServicesRequest,
    VendorSetupContextResponse,
    VendorUpdateRequest,
    PublicListingDirectoryResponse,
)
from app.services import vendor_portal_service

public_router = APIRouter(tags=["vendor-public"])
portal_router = APIRouter(prefix="/vendor-portal", tags=["vendor-portal"])


# ── Public: listing directory ─────────────────────────────────────────────────

@public_router.get("/vendor-listings/public", response_model=PublicListingDirectoryResponse)
async def public_listings_directory(org_id: str = Query(..., description="Organisation ID")):
    return await vendor_portal_service.get_public_listings_directory(org_id)


# ── Public: listing detail + apply ────────────────────────────────────────────

@public_router.get("/vendor-listings/{listing_id}/public")
async def public_listing(listing_id: str):
    return await vendor_portal_service.get_public_listing(listing_id)


@public_router.post("/vendor-listings/{listing_id}/apply")
async def apply_to_listing(listing_id: str, request: VendorApplicationCreateRequest):
    return await vendor_portal_service.submit_application(listing_id, request)


# ── Public: onboarding wizard ─────────────────────────────────────────────────

@public_router.get("/vendor-onboarding/{token}", response_model=VendorOnboardingContextResponse)
async def get_onboarding_context(token: str):
    return await vendor_portal_service.get_onboarding_context(token)


@public_router.post("/vendor-onboarding/{token}/company", response_model=VendorProfileResponse)
async def save_company_details(token: str, request: VendorCompanyDetailsRequest):
    return await vendor_portal_service.save_company_details(token, request)


@public_router.post("/vendor-onboarding/{token}/services", response_model=VendorProfileResponse)
async def save_services(token: str, request: VendorServicesRequest):
    return await vendor_portal_service.save_services(token, request)


@public_router.post("/vendor-onboarding/{token}/documents")
async def upload_document(
    token: str,
    doc_type: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
):
    content = await file.read()
    return await vendor_portal_service.upload_document(
        token,
        doc_type,
        name or file.filename or "document",
        content,
        file.content_type or "application/octet-stream",
    )


@public_router.post("/vendor-onboarding/{token}/complete", response_model=VendorProfileResponse)
async def complete_onboarding(token: str):
    return await vendor_portal_service.complete_onboarding(token)


# ── Public: contract view + sign ──────────────────────────────────────────────

@public_router.get("/vendor-contracts/{token}/view", response_model=VendorContractViewResponse)
async def view_contract(token: str):
    return await vendor_portal_service.get_contract_view(token)


@public_router.post("/vendor-contracts/{token}/sign")
async def sign_contract(token: str, request: VendorContractSignRequest, req: Request):
    ip = req.client.host if req.client else "unknown"
    return await vendor_portal_service.sign_contract(token, request, ip)


# ── Public: account setup / activate ─────────────────────────────────────────

@public_router.get("/vendor-setup/{token}", response_model=VendorSetupContextResponse)
async def get_setup_context(token: str):
    return await vendor_portal_service.get_setup_context(token)


@public_router.post("/vendor-setup/{token}/activate", response_model=VendorActivateResponse)
async def activate_account(token: str, request: VendorActivateRequest):
    return await vendor_portal_service.activate_account(token, request)


# ── Vendor Portal (authenticated) ────────────────────────────────────────────

@portal_router.get("/dashboard", response_model=VendorPortalDashboardResponse)
async def portal_dashboard(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    return await vendor_portal_service.get_portal_dashboard(current_user)


@portal_router.get("/profile", response_model=VendorProfileResponse)
async def get_own_profile(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    return await vendor_portal_service.get_own_profile(current_user)


@portal_router.patch("/profile", response_model=VendorProfileResponse)
async def update_own_profile(
    request: VendorUpdateRequest,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    return await vendor_portal_service.update_own_profile(request, current_user)


@portal_router.get("/contracts", response_model=VendorContractListResponse)
async def get_own_contracts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    items, total = await vendor_portal_service.get_own_contracts(current_user, page, page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@portal_router.get("/contracts/{contract_id}", response_model=VendorContractResponse)
async def get_own_contract(
    contract_id: str,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    return await vendor_portal_service.get_own_contract(contract_id, current_user)


@portal_router.get("/tickets")
async def get_own_tickets(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_roles("service_provider")),
):
    from app.repositories.ticket_repository import ticket_repository
    items, total = await ticket_repository.list(
        org_id=current_user.org_id,
        assigned_to=current_user.user_id,
        status=status,
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
                "unit_id": t.unit_id,
                "description": t.description,
                "created_at": t.created_at,
                "updated_at": t.updated_at,
            }
            for t in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
