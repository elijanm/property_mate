"""
Framework Service Provider Portal API
=====================================
Public routes: /api/v1/framework-portal/invite/{token}/*
Authenticated routes: /api/v1/framework-portal/*  (role: service_provider, fw_vendor context)
"""
from __future__ import annotations

import asyncio
import io
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.core.logging import get_logger
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.models.framework import (
    FrameworkContract,
    FrameworkInvitedVendor,
    WorkOrder,
)

logger = get_logger(__name__)

# Two routers: public (no auth) + portal (requires service_provider JWT)
public_router = APIRouter(prefix="/framework-portal", tags=["framework-portal-public"])
portal_router = APIRouter(prefix="/framework-portal", tags=["framework-portal"])


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_vendor(vendor_id: str) -> FrameworkInvitedVendor:
    """Look up vendor by its own MongoDB id (stored as JWT sub)."""
    from beanie import PydanticObjectId
    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == PydanticObjectId(vendor_id),
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor profile not found")
    return vendor


async def _s3_upload(key: str, data: bytes, content_type: str) -> None:
    from app.core.s3 import upload_file
    await upload_file(key, data, content_type)


async def _s3_presign(key: str) -> str:
    from app.core.s3 import generate_presigned_url
    return await generate_presigned_url(key)


def _vendor_resp(v: FrameworkInvitedVendor) -> dict:
    return {
        "id": str(v.id),
        "framework_id": v.framework_id,
        "org_id": v.org_id,
        "name": v.name,
        "contact_name": v.contact_name,
        "email": v.email,
        "phone": v.phone,
        "mobile": v.mobile,
        "specialization": v.specialization,
        "regions": v.regions,
        "site_codes": v.site_codes,
        "status": v.status,
        "has_selfie": bool(v.selfie_key),
        "has_id_front": bool(v.id_front_key),
        "has_id_back": bool(v.id_back_key),
        "has_badge": bool(v.badge_key),
        "has_cv": bool(v.cv_key),
        "certificate_count": len(v.certificate_keys),
        "gps_lat": v.gps_lat,
        "gps_lng": v.gps_lng,
        "invited_at": v.invited_at.isoformat(),
        "activated_at": v.activated_at.isoformat() if v.activated_at else None,
    }


# ── PUBLIC: Invite acceptance flow ───────────────────────────────────────────

class InviteInfoResponse(BaseModel):
    id: str
    name: str
    contact_name: str
    email: str
    specialization: Optional[str] = None
    framework_name: str
    client_name: str
    org_name: str
    status: str
    is_activated: bool


@public_router.get("/invite/{token}", response_model=InviteInfoResponse)
async def get_invite_info(token: str) -> InviteInfoResponse:
    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.portal_token == token,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Invitation not found or expired")

    from beanie import PydanticObjectId as _OID
    fw = await FrameworkContract.find_one(
        FrameworkContract.id == _OID(vendor.framework_id),
    )
    from app.models.org import Org
    org = await Org.find_one(Org.org_id == vendor.org_id)

    return InviteInfoResponse(
        id=str(vendor.id),
        name=vendor.name,
        contact_name=vendor.contact_name,
        email=vendor.email,
        specialization=vendor.specialization,
        framework_name=fw.name if fw else "Framework Contract",
        client_name=fw.client_name if fw else "",
        org_name=(org.business.name if org and org.business else "PMS"),
        status=vendor.status,
        is_activated=vendor.user_id is not None,
    )


class ActivatePayload(BaseModel):
    password: str
    mobile: str
    site_codes: List[str] = []
    specialization: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None


class ActivateResponse(BaseModel):
    token: str
    vendor_id: str
    status: str
    message: str


@public_router.post("/invite/{token}/activate", response_model=ActivateResponse)
async def activate_invite(token: str, payload: ActivatePayload) -> ActivateResponse:
    """Set password directly on the vendor record — no separate User account needed."""
    from app.services.auth_service import hash_password, create_access_token

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.portal_token == token,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Invitation not found or expired")

    if vendor.portal_password_hash and vendor.activated_at:
        raise HTTPException(status_code=409, detail="Already activated. Please log in.")

    vendor.portal_password_hash = hash_password(payload.password)
    vendor.mobile = payload.mobile
    vendor.site_codes = payload.site_codes
    if payload.specialization:
        vendor.specialization = payload.specialization
    if payload.gps_lat is not None:
        vendor.gps_lat = payload.gps_lat
    if payload.gps_lng is not None:
        vendor.gps_lng = payload.gps_lng
    vendor.status = "pending_review"
    vendor.activated_at = datetime.utcnow()
    await vendor.save()

    jwt_token = create_access_token(
        user_id=str(vendor.id),   # vendor id IS the subject
        org_id=vendor.org_id,
        role="service_provider",
    )

    return ActivateResponse(
        token=jwt_token,
        vendor_id=str(vendor.id),
        status=vendor.status,
        message="Account activated. Please upload your ID and selfie to complete verification.",
    )


class PortalLoginPayload(BaseModel):
    email: str
    password: str


class PortalLoginResponse(BaseModel):
    token: str
    vendor_id: str
    name: str
    status: str


@public_router.post("/auth/login", response_model=PortalLoginResponse)
async def portal_login(payload: PortalLoginPayload) -> PortalLoginResponse:
    """Dedicated login for framework service providers — completely separate from main auth."""
    from app.services.auth_service import verify_password, create_access_token

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.email == payload.email,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor or not vendor.portal_password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, vendor.portal_password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if vendor.status == "suspended":
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact the framework manager.")

    jwt_token = create_access_token(
        user_id=str(vendor.id),
        org_id=vendor.org_id,
        role="service_provider",
    )

    return PortalLoginResponse(
        token=jwt_token,
        vendor_id=str(vendor.id),
        name=vendor.contact_name,
        status=vendor.status,
    )


_ALLOWED_PHOTO_TYPES = ("selfie", "id_front", "id_back")
_ALLOWED_DOC_TYPES = ("cv", "certificate")

@public_router.post("/invite/{token}/upload/{file_type}")
async def upload_kyc_file(
    token: str,
    file_type: str,  # selfie | id_front | id_back | cv | certificate
    file: UploadFile = File(...),
) -> dict:
    """Upload KYC photos, CV, or certificates (allowed before full activation for UX flow)."""
    if file_type not in (*_ALLOWED_PHOTO_TYPES, *_ALLOWED_DOC_TYPES):
        raise HTTPException(status_code=400, detail=f"file_type must be one of: selfie, id_front, id_back, cv, certificate")

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.portal_token == token,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Invitation not found")

    data = await file.read()
    content_type = file.content_type or ("application/pdf" if file_type in ("cv", "certificate") else "image/jpeg")
    ext = (file.filename or "").rsplit(".", 1)[-1] or content_type.split("/")[-1].split("+")[0]
    key = f"{vendor.org_id}/framework-vendors/{vendor.id}/{file_type}_{uuid.uuid4().hex[:8]}.{ext}"

    await _s3_upload(key, data, content_type)

    if file_type == "selfie":
        vendor.selfie_key = key
    elif file_type == "id_front":
        vendor.id_front_key = key
    elif file_type == "id_back":
        vendor.id_back_key = key
    elif file_type == "cv":
        vendor.cv_key = key
    else:  # certificate
        vendor.certificate_keys = [*vendor.certificate_keys, key]
    await vendor.save()

    # Auto-generate badge if all KYC photos are present
    if vendor.selfie_key and vendor.id_front_key and vendor.id_back_key and vendor.activated_at:
        asyncio.ensure_future(_generate_and_store_badge(vendor))

    return {"ok": True, "key": key}


# ── Badge generation ──────────────────────────────────────────────────────────

async def _generate_and_store_badge(vendor: FrameworkInvitedVendor) -> None:
    """Generate a contractor badge PDF and store it in S3."""
    try:
        from beanie import PydanticObjectId as _OID
        fw = await FrameworkContract.find_one(
            FrameworkContract.id == _OID(vendor.framework_id),
        )
        from app.models.org import Org
        org = await Org.find_one(Org.org_id == vendor.org_id)
        org_name = (org.business.name if org and org.business else "PMS")

        pdf_bytes = _build_badge_pdf(vendor, fw, org_name)
        key = f"{vendor.org_id}/framework-vendors/{vendor.id}/badge.pdf"
        await _s3_upload(key, pdf_bytes, "application/pdf")
        vendor.badge_key = key
        await vendor.save()
        logger.info("badge_generated", vendor_id=str(vendor.id))
    except Exception as exc:
        logger.error("badge_generation_failed", vendor_id=str(vendor.id), error=str(exc))


def _build_badge_pdf(
    vendor: FrameworkInvitedVendor,
    fw: Optional[FrameworkContract],
    org_name: str,
) -> bytes:
    """Build a contractor ID badge PDF using reportlab."""
    try:
        from reportlab.lib.pagesizes import A6
        from reportlab.lib.units import mm
        from reportlab.lib.colors import HexColor, white, black
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    except ImportError:
        # reportlab not installed — return empty bytes
        logger.warning("reportlab_not_installed", action="skip_badge_pdf")
        return b""

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A6,
        leftMargin=8 * mm,
        rightMargin=8 * mm,
        topMargin=8 * mm,
        bottomMargin=8 * mm,
    )

    amber = HexColor("#D97706")
    dark = HexColor("#111827")
    gray = HexColor("#6B7280")
    light_bg = HexColor("#FFFBEB")

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", fontSize=13, textColor=white, fontName="Helvetica-Bold", alignment=1)
    sub_style = ParagraphStyle("sub", fontSize=7, textColor=white, fontName="Helvetica", alignment=1)
    label_style = ParagraphStyle("label", fontSize=6, textColor=gray, fontName="Helvetica")
    value_style = ParagraphStyle("value", fontSize=9, textColor=dark, fontName="Helvetica-Bold")
    small_style = ParagraphStyle("small", fontSize=7, textColor=gray, fontName="Helvetica")

    badge_no = str(vendor.id)[-6:].upper()
    sites_text = ", ".join(vendor.site_codes) if vendor.site_codes else "All Assigned Sites"
    contract_name = fw.name if fw else "Framework Contract"
    client_name = fw.client_name if fw else ""
    contract_end = fw.contract_end if fw else "N/A"

    header_table = Table(
        [[Paragraph(org_name.upper(), title_style)],
         [Paragraph("CONTRACTOR SERVICE PROVIDER", sub_style)]],
        colWidths=[90 * mm],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), amber),
        ("ROWPADDING", (0, 0), (-1, -1), 6),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    detail_rows = [
        [Paragraph("NAME", label_style), Paragraph(vendor.contact_name, value_style)],
        [Paragraph("COMPANY", label_style), Paragraph(vendor.name, value_style)],
        [Paragraph("BADGE NO.", label_style), Paragraph(f"SP-{badge_no}", value_style)],
        [Paragraph("SPECIALIZATION", label_style), Paragraph(vendor.specialization or "General", value_style)],
        [Paragraph("SITES COVERED", label_style), Paragraph(sites_text, small_style)],
        [Paragraph("CONTRACT", label_style), Paragraph(f"{contract_name} | {client_name}", small_style)],
        [Paragraph("VALID UNTIL", label_style), Paragraph(contract_end, value_style)],
    ]

    detail_table = Table(detail_rows, colWidths=[28 * mm, 62 * mm])
    detail_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light_bg),
        ("ROWPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.3, HexColor("#E5E7EB")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    footer_table = Table(
        [[Paragraph(f"Issued: {datetime.utcnow().strftime('%d %b %Y')}  |  For verification contact {org_name}", small_style)]],
        colWidths=[90 * mm],
    )
    footer_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), amber),
        ("ROWPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))

    story = [header_table, Spacer(1, 4 * mm), detail_table, Spacer(1, 4 * mm), footer_table]
    doc.build(story)
    return buf.getvalue()


# ── AUTHENTICATED portal endpoints ────────────────────────────────────────────

@portal_router.get("/me")
async def get_my_profile(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    vendor = await _get_vendor(current_user.user_id)
    resp = _vendor_resp(vendor)

    # Add presigned URLs for photos
    try:
        if vendor.selfie_key:
            resp["selfie_url"] = await _s3_presign(vendor.selfie_key)
        if vendor.id_front_key:
            resp["id_front_url"] = await _s3_presign(vendor.id_front_key)
        if vendor.id_back_key:
            resp["id_back_url"] = await _s3_presign(vendor.id_back_key)
        if vendor.badge_key:
            resp["badge_url"] = await _s3_presign(vendor.badge_key)
    except Exception:
        pass

    return resp


class UpdateProfilePayload(BaseModel):
    mobile: Optional[str] = None
    specialization: Optional[str] = None
    site_codes: Optional[List[str]] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None


@portal_router.patch("/me")
async def update_my_profile(
    payload: UpdateProfilePayload,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    vendor = await _get_vendor(current_user.user_id)
    if payload.mobile is not None:
        vendor.mobile = payload.mobile
    if payload.specialization is not None:
        vendor.specialization = payload.specialization
    if payload.site_codes is not None:
        vendor.site_codes = payload.site_codes
    if payload.gps_lat is not None:
        vendor.gps_lat = payload.gps_lat
    if payload.gps_lng is not None:
        vendor.gps_lng = payload.gps_lng
    await vendor.save()
    return _vendor_resp(vendor)


@portal_router.post("/me/upload/{photo_type}")
async def upload_my_photo(
    photo_type: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    if photo_type not in ("selfie", "id_front", "id_back"):
        raise HTTPException(status_code=400, detail="photo_type must be selfie, id_front, or id_back")

    vendor = await _get_vendor(current_user.user_id)
    data = await file.read()
    content_type = file.content_type or "image/jpeg"
    ext = content_type.split("/")[-1].split("+")[0]
    key = f"{vendor.org_id}/framework-vendors/{vendor.id}/{photo_type}.{ext}"

    await _s3_upload(key, data, content_type)

    if photo_type == "selfie":
        vendor.selfie_key = key
    elif photo_type == "id_front":
        vendor.id_front_key = key
    else:
        vendor.id_back_key = key
    await vendor.save()

    if vendor.selfie_key and vendor.id_front_key and vendor.id_back_key:
        asyncio.ensure_future(_generate_and_store_badge(vendor))

    return {"ok": True}


# ── Work Orders ───────────────────────────────────────────────────────────────

def _wo_summary(wo: WorkOrder) -> dict:
    return {
        "id": str(wo.id),
        "work_order_number": wo.work_order_number,
        "title": wo.title,
        "service_type": wo.service_type,
        "status": wo.status,
        "planned_date": wo.planned_date,
        "start_date": wo.start_date,
        "completion_date": wo.completion_date,
        "total_assets": wo.total_assets,
        "route_stops": [
            {
                "sequence": s.sequence,
                "site_name": s.site_name,
                "site_code": s.site_code,
                "status": s.status,
                "gps_lat": s.gps_lat,
                "gps_lng": s.gps_lng,
            }
            for s in wo.route_stops
        ],
        "pre_inspection_status": wo.pre_inspection.status if wo.pre_inspection else None,
        "has_pre_inspection": wo.pre_inspection is not None,
    }


@portal_router.get("/work-orders")
async def list_my_work_orders(
    status: Optional[str] = None,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    vendor = await _get_vendor(current_user.user_id)

    filters = [
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == str(vendor.id),
        WorkOrder.deleted_at == None,
    ]
    if status:
        filters.append(WorkOrder.status == status)

    work_orders = await WorkOrder.find(*filters).sort(-WorkOrder.created_at).to_list()
    return {"items": [_wo_summary(wo) for wo in work_orders], "total": len(work_orders)}


@portal_router.get("/work-orders/{work_order_id}")
async def get_my_work_order(
    work_order_id: str,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    from beanie import PydanticObjectId
    vendor = await _get_vendor(current_user.user_id)

    wo = await WorkOrder.find_one(
        WorkOrder.id == PydanticObjectId(work_order_id),
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == str(vendor.id),
        WorkOrder.deleted_at == None,
    )
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    detail = _wo_summary(wo)
    detail["parts_used"] = [
        {"part_name": p.part_name, "part_number": p.part_number, "quantity": p.quantity,
         "unit_cost": p.unit_cost, "total_cost": p.total_cost}
        for p in wo.parts_used
    ]
    detail["labor_hours"] = wo.labor_hours
    detail["transport_cost"] = wo.transport_cost
    detail["accommodation_cost"] = wo.accommodation_cost
    detail["report_notes"] = wo.report_notes
    if wo.pre_inspection:
        pi = wo.pre_inspection
        detail["pre_inspection"] = {
            "inspection_date": pi.inspection_date,
            "technician_name": pi.technician_name,
            "condition_notes": pi.condition_notes,
            "status": pi.status,
            "estimated_total": pi.estimated_total,
            "items": [
                {"part_name": i.part_name, "part_number": i.part_number,
                 "quantity": i.quantity, "estimated_unit_cost": i.estimated_unit_cost,
                 "estimated_total_cost": i.estimated_total_cost, "notes": i.notes}
                for i in pi.items
            ],
            "approval_notes": pi.approval_notes,
        }

    return detail


class WoRespondPayload(BaseModel):
    action: str  # accept | start | complete
    notes: Optional[str] = None
    technician_names: Optional[List[str]] = None


@portal_router.patch("/work-orders/{work_order_id}/respond")
async def respond_to_work_order(
    work_order_id: str,
    payload: WoRespondPayload,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    from beanie import PydanticObjectId
    vendor = await _get_vendor(current_user.user_id)

    wo = await WorkOrder.find_one(
        WorkOrder.id == PydanticObjectId(work_order_id),
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == str(vendor.id),
        WorkOrder.deleted_at == None,
    )
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    transitions = {
        "accept": ("assigned", "en_route"),
        "start": ("en_route", "in_progress"),
        "complete": ("in_progress", "completed"),
    }
    if payload.action not in transitions:
        raise HTTPException(status_code=400, detail=f"Unknown action '{payload.action}'")

    allowed_from, new_status = transitions[payload.action]
    if wo.status != allowed_from:
        raise HTTPException(
            status_code=409,
            detail=f"Work order is '{wo.status}', expected '{allowed_from}' to perform '{payload.action}'"
        )

    wo.status = new_status  # type: ignore[assignment]
    if payload.notes:
        wo.report_notes = payload.notes
    if payload.technician_names:
        wo.technician_names = payload.technician_names
    if new_status == "in_progress":
        wo.start_date = datetime.utcnow().strftime("%Y-%m-%d")
    if new_status == "completed":
        wo.completion_date = datetime.utcnow().strftime("%Y-%m-%d")
    wo.updated_at = datetime.utcnow()
    await wo.save()

    return _wo_summary(wo)


class PreInspectionItemIn(BaseModel):
    part_name: str
    part_number: Optional[str] = None
    kva_range: Optional[str] = None
    quantity: float = 1
    estimated_unit_cost: float = 0
    notes: Optional[str] = None


class PreInspectionPayload(BaseModel):
    inspection_date: str
    technician_name: str
    condition_notes: str
    items: List[PreInspectionItemIn] = []


@portal_router.post("/work-orders/{work_order_id}/pre-inspection")
async def submit_pre_inspection(
    work_order_id: str,
    payload: PreInspectionPayload,
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    from beanie import PydanticObjectId
    from app.models.framework import PreInspection, PreInspectionItem
    vendor = await _get_vendor(current_user.user_id)

    wo = await WorkOrder.find_one(
        WorkOrder.id == PydanticObjectId(work_order_id),
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == str(vendor.id),
        WorkOrder.deleted_at == None,
    )
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    items = []
    total = 0.0
    for item in payload.items:
        cost = item.estimated_unit_cost * item.quantity
        total += cost
        items.append(PreInspectionItem(
            part_name=item.part_name,
            part_number=item.part_number,
            kva_range=item.kva_range,
            quantity=item.quantity,
            estimated_unit_cost=item.estimated_unit_cost,
            estimated_total_cost=cost,
            notes=item.notes,
        ))

    wo.pre_inspection = PreInspection(
        inspection_date=payload.inspection_date,
        technician_name=payload.technician_name,
        condition_notes=payload.condition_notes,
        items=items,
        estimated_total=total,
        status="submitted",
    )
    wo.status = "pre_inspection"  # type: ignore[assignment]
    wo.updated_at = datetime.utcnow()
    await wo.save()

    return {"ok": True, "estimated_total": total, "status": wo.status}


# ── Tickets ───────────────────────────────────────────────────────────────────

@portal_router.get("/tickets")
async def list_my_tickets(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    vendor = await _get_vendor(current_user.user_id)
    from app.models.ticket import Ticket
    tickets = await Ticket.find(
        Ticket.org_id == vendor.org_id,
        Ticket.assigned_to_user_id == current_user.user_id,
        Ticket.deleted_at == None,
    ).sort(-Ticket.created_at).limit(50).to_list()

    return {
        "items": [
            {
                "id": str(t.id),
                "reference": t.reference,
                "title": t.title,
                "category": t.category,
                "status": t.status,
                "priority": t.priority,
                "created_at": t.created_at.isoformat(),
            }
            for t in tickets
        ],
        "total": len(tickets),
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

@portal_router.get("/metrics")
async def get_my_metrics(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    vendor = await _get_vendor(current_user.user_id)
    vendor_id = str(vendor.id)

    all_wos = await WorkOrder.find(
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == vendor_id,
        WorkOrder.deleted_at == None,
    ).to_list()

    completed = [wo for wo in all_wos if wo.status in ("completed", "signed_off")]
    in_progress = [wo for wo in all_wos if wo.status == "in_progress"]
    pending = [wo for wo in all_wos if wo.status in ("assigned", "en_route")]
    cancelled = [wo for wo in all_wos if wo.status == "cancelled"]

    completion_rate = round(len(completed) / len(all_wos) * 100, 1) if all_wos else 0

    # On-time: planned_date >= completion_date
    on_time = 0
    for wo in completed:
        if wo.completion_date and wo.planned_date:
            if wo.completion_date <= wo.planned_date:
                on_time += 1
    on_time_rate = round(on_time / len(completed) * 100, 1) if completed else 0

    # Pre-inspection submission rate
    pi_submitted = sum(1 for wo in all_wos if wo.pre_inspection is not None)
    pi_rate = round(pi_submitted / len(all_wos) * 100, 1) if all_wos else 0

    # Sites covered
    sites_data = []
    for sc in vendor.site_codes:
        site_wos = [wo for wo in all_wos if any(s.site_code == sc for s in wo.route_stops)]
        sites_data.append({
            "site_code": sc,
            "total_work_orders": len(site_wos),
            "completed": len([wo for wo in site_wos if wo.status in ("completed", "signed_off")]),
        })

    return {
        "summary": {
            "total_work_orders": len(all_wos),
            "completed": len(completed),
            "in_progress": len(in_progress),
            "pending": len(pending),
            "cancelled": len(cancelled),
            "completion_rate": completion_rate,
            "on_time_rate": on_time_rate,
            "pre_inspection_rate": pi_rate,
        },
        "sites": sites_data,
        "vendor": {
            "name": vendor.name,
            "contact_name": vendor.contact_name,
            "specialization": vendor.specialization,
            "status": vendor.status,
            "site_codes": vendor.site_codes,
        },
    }


# ── Owner: approve/suspend vendor ─────────────────────────────────────────────

@portal_router.patch(
    "/admin/vendors/{vendor_id}/status",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_vendor_status(
    vendor_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    from beanie import PydanticObjectId
    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == PydanticObjectId(vendor_id),
        FrameworkInvitedVendor.org_id == current_user.org_id,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    new_status = body.get("status")
    if new_status not in ("active", "suspended", "pending_review"):
        raise HTTPException(status_code=400, detail="status must be active, suspended, or pending_review")

    vendor.status = new_status
    await vendor.save()

    # If approving, generate badge if docs are present
    if new_status == "active" and vendor.selfie_key and vendor.id_front_key and vendor.id_back_key:
        asyncio.ensure_future(_generate_and_store_badge(vendor))

    return {"ok": True, "status": vendor.status}
