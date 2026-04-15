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
        "home_address": v.home_address,
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
    available_sites: List[dict] = []


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

    sites = fw.sites if fw and fw.sites else []
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
        available_sites=[{"site_code": s.site_code, "site_name": s.site_name, "region": s.region} for s in sites],
    )


class ActivatePayload(BaseModel):
    password: str
    mobile: str
    site_codes: List[str] = []
    specialization: Optional[str] = None
    home_address: Optional[str] = None
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
    if payload.home_address:
        vendor.home_address = payload.home_address
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
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if not verify_password(payload.password, vendor.portal_password_hash):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if vendor.status == "suspended":
        raise HTTPException(status_code=400, detail="Your account has been suspended. Contact the framework manager.")

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


class RequestOtpPayload(BaseModel):
    email: str


class VerifyOtpPayload(BaseModel):
    email: str
    otp: str


@public_router.post("/auth/request-otp")
async def request_portal_otp(payload: RequestOtpPayload) -> dict:
    """Send a 6-digit OTP to the vendor's registered email."""
    import random
    from app.core.email import send_email, framework_portal_otp_html
    from app.core.redis import get_redis_client

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.email == payload.email,
        FrameworkInvitedVendor.deleted_at == None,
    )
    # Always respond "sent" to prevent email enumeration
    if not vendor or vendor.status == "invited":
        return {"ok": True}

    otp = f"{random.randint(0, 999999):06d}"
    key = f"portal_otp:{vendor.email}"
    try:
        redis = get_redis_client()
        await redis.setex(key, 600, otp)
    except Exception:
        # Redis unavailable — store on vendor document as fallback (dev mode)
        vendor.portal_otp = otp
        vendor.portal_otp_expires = datetime.utcnow().timestamp() + 600
        await vendor.save()

    html = framework_portal_otp_html(contact_name=vendor.contact_name, otp_code=otp)
    asyncio.ensure_future(
        send_email(to=vendor.email, subject="Service Provider Portal — Sign-In Code", html=html)
    )
    logger.info("portal_otp_sent", email=vendor.email, otp=otp)  # dev convenience
    return {"ok": True}


@public_router.post("/auth/verify-otp", response_model=PortalLoginResponse)
async def verify_portal_otp(payload: VerifyOtpPayload) -> PortalLoginResponse:
    """Verify OTP and return a JWT token."""
    from app.services.auth_service import create_access_token
    from app.core.redis import get_redis_client

    key = f"portal_otp:{payload.email}"

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.email == payload.email,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    # Try Redis first, fall back to vendor document OTP
    otp_valid = False
    try:
        redis = get_redis_client()
        stored = await redis.get(key)
        if stored and stored == payload.otp:
            await redis.delete(key)
            otp_valid = True
    except Exception:
        pass

    if not otp_valid:
        # Fallback: check OTP stored on vendor document
        import time as _time
        if (
            getattr(vendor, "portal_otp", None) == payload.otp
            and getattr(vendor, "portal_otp_expires", 0) > _time.time()
        ):
            vendor.portal_otp = None
            vendor.portal_otp_expires = None
            await vendor.save()
            otp_valid = True

    if not otp_valid:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if vendor.status == "suspended":
        raise HTTPException(status_code=400, detail="Your account has been suspended. Contact the framework manager.")

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

@public_router.get("/verify/{vendor_id}")
async def verify_badge(vendor_id: str) -> dict:
    """
    Public endpoint scanned from the QR code on the contractor badge.
    Returns identity info + active work orders for verification.
    """
    from beanie import PydanticObjectId as _OID
    try:
        oid = _OID(vendor_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid badge ID")

    vendor = await FrameworkInvitedVendor.find_one(
        FrameworkInvitedVendor.id == oid,
        FrameworkInvitedVendor.deleted_at == None,
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Badge not found")

    fw = await FrameworkContract.find_one(
        FrameworkContract.id == _OID(vendor.framework_id),
    )
    from app.models.org import Org
    org = await Org.find_one(Org.org_id == vendor.org_id)
    org_name = org.business.name if org and org.business else "PMS"

    # Active work orders assigned to this vendor
    active_wos = await WorkOrder.find(
        WorkOrder.org_id == vendor.org_id,
        WorkOrder.assigned_vendor_id == str(vendor.id),
        {"status": {"$in": ["assigned", "en_route", "in_progress"]}},
        WorkOrder.deleted_at == None,
    ).to_list()

    selfie_url = await _s3_presign(vendor.selfie_key) if vendor.selfie_key else None

    return {
        "valid": vendor.status == "active",
        "status": vendor.status,
        "vendor_id": str(vendor.id),
        "name": vendor.contact_name,
        "company": vendor.name,
        "specialization": vendor.specialization or "General Services",
        "site_codes": vendor.site_codes,
        "badge_no": f"SP-{str(vendor.id)[-8:].upper()}",
        "org_name": org_name,
        "framework_name": fw.name if fw else "",
        "contract_end": fw.contract_end if fw else "",
        "selfie_url": selfie_url,
        "active_work_orders": [
            {
                "id": str(wo.id),
                "work_order_number": wo.work_order_number,
                "title": wo.title,
                "status": wo.status,
                "planned_date": wo.planned_date,
                "sites": [s.site_code for s in (wo.route_stops or [])],
            }
            for wo in active_wos
        ],
    }


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

async def _download_s3_bytes(key: Optional[str]) -> Optional[bytes]:
    """Download a file from S3 and return raw bytes, or None on failure."""
    if not key:
        return None
    try:
        from app.core.s3 import download_file
        return await download_file(key)
    except Exception:
        return None


async def _generate_and_store_badge(vendor: FrameworkInvitedVendor) -> None:
    """Generate a contractor badge PDF (front + back) and store it in S3."""
    try:
        from beanie import PydanticObjectId as _OID
        fw = await FrameworkContract.find_one(
            FrameworkContract.id == _OID(vendor.framework_id),
        )
        from app.models.org import Org
        org = await Org.find_one(Org.org_id == vendor.org_id)
        org_name    = (org.business.name    if org and org.business else "PMS")
        org_address = (org.business.address if org and org.business else None)
        org_phone   = (org.business.phone   if org and org.business else None)
        org_email   = (org.business.email   if org and org.business else None)
        org_logo_url = (org.business.logo_url if org and org.business else None)

        # Download selfie and org logo to embed in badge
        selfie_bytes = await _download_s3_bytes(vendor.selfie_key)
        org_logo_bytes: Optional[bytes] = None
        if org_logo_url:
            try:
                from app.core.s3 import download_file as _dl
                org_logo_bytes = await _dl(org_logo_url)
            except Exception:
                pass

        pdf_bytes = _build_badge_pdf(
            vendor, fw, org_name, selfie_bytes=selfie_bytes,
            org_address=org_address, org_phone=org_phone, org_email=org_email,
            org_logo_bytes=org_logo_bytes,
        )
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
    selfie_bytes: Optional[bytes] = None,
    org_address: Optional[str] = None,
    org_phone: Optional[str] = None,
    org_email: Optional[str] = None,
    org_logo_bytes: Optional[bytes] = None,
) -> bytes:
    """
    Build a contractor ID badge PDF — CR80 card size (85.6 × 54 mm), print-ready.
    Page 1: front — photo (top-aligned), name/company/spec/contract/valid-until, QR code.
    Page 2: back  — org contact block, permitted sites list, non-transferable notice.
    """
    try:
        from reportlab.lib.units import mm
        from reportlab.lib.colors import HexColor, white
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.utils import ImageReader as _IR
    except ImportError:
        logger.warning("reportlab_not_installed", action="skip_badge_pdf")
        return b""

    # CR80 standard ID card size
    CARD_W = 85.6 * mm
    CARD_H = 54.0 * mm

    AMBER      = HexColor("#D97706")
    AMBER_DARK = HexColor("#92400E")
    AMBER_LIGHT = HexColor("#FFFBEB")
    DARK  = HexColor("#111827")
    GRAY  = HexColor("#6B7280")
    WHITE = white

    badge_no       = f"SP-{str(vendor.id)[-8:].upper()}"
    contract_name  = fw.name if fw else "Framework Contract"
    contract_end   = fw.contract_end if fw else "N/A"
    specialization = vendor.specialization or "General Services"
    issued         = datetime.utcnow().strftime("%d %b %Y")

    # QR code
    from app.core.config import settings
    app_base    = getattr(settings, "app_base_url", "").rstrip("/")
    verify_url  = f"{app_base}/framework-portal/verify/{str(vendor.id)}" if app_base else f"VERIFY:{str(vendor.id)}"

    qr_img_bytes: Optional[bytes] = None
    try:
        import qrcode  # type: ignore
        qr = qrcode.QRCode(version=2, box_size=4, border=1)
        qr.add_data(verify_url)
        qr.make(fit=True)
        qr_pil = qr.make_image(fill_color="#92400E", back_color="#FFFBEB")
        qr_buf = io.BytesIO()
        qr_pil.save(qr_buf, format="PNG")
        qr_img_bytes = qr_buf.getvalue()
    except ImportError:
        pass

    # ── Shared zone constants ─────────────────────────────────────────────────
    HEADER_H = 11 * mm
    FOOTER_H =  5 * mm
    ACCENT_W =  2 * mm
    CONTENT_TOP    = CARD_H - HEADER_H   # 43 mm from bottom
    CONTENT_BOTTOM = FOOTER_H            #  5 mm from bottom

    LOGO_SIZE = 7 * mm   # square logo in header

    def _draw_chrome(c: rl_canvas.Canvas, title_line1: str, title_line2: str) -> None:
        """Draw header, footer, left accent stripe (shared by front and back)."""
        c.setFillColor(WHITE)
        c.rect(0, 0, CARD_W, CARD_H, fill=1, stroke=0)
        c.setFillColor(AMBER)
        c.rect(0, CARD_H - HEADER_H, CARD_W, HEADER_H, fill=1, stroke=0)
        c.setFillColor(AMBER)
        c.rect(0, 0, CARD_W, FOOTER_H, fill=1, stroke=0)
        c.setFillColor(AMBER)
        c.rect(0, FOOTER_H, ACCENT_W, CONTENT_TOP - FOOTER_H, fill=1, stroke=0)

        # Org logo — left side of header band
        logo_x = ACCENT_W + 1.5 * mm
        logo_y = CARD_H - HEADER_H + (HEADER_H - LOGO_SIZE) / 2
        if org_logo_bytes:
            try:
                logo_reader = _IR(io.BytesIO(org_logo_bytes))
                c.drawImage(logo_reader, logo_x, logo_y, LOGO_SIZE, LOGO_SIZE,
                            preserveAspectRatio=True, mask="auto")
            except Exception:
                _draw_logo_placeholder(c, logo_x, logo_y)
        else:
            _draw_logo_placeholder(c, logo_x, logo_y)

        # Header text — offset right of logo
        text_start_x = logo_x + LOGO_SIZE + 1.5 * mm
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(text_start_x, CARD_H - 5.5 * mm, title_line1[:32])
        c.setFont("Helvetica", 4.5)
        c.drawString(text_start_x, CARD_H - 9 * mm, title_line2)

    def _draw_logo_placeholder(c: rl_canvas.Canvas, x: float, y: float) -> None:
        """Draw a simple building icon as fallback when no logo is available."""
        c.setFillColor(WHITE)
        c.setFillAlpha(0.25)
        c.rect(x, y, LOGO_SIZE, LOGO_SIZE, fill=1, stroke=0)
        c.setFillAlpha(1.0)
        # Simple building silhouette in white
        bx, by = x + 1 * mm, y + 0.5 * mm
        bw, bh = LOGO_SIZE - 2 * mm, LOGO_SIZE - 1.5 * mm
        c.setFillColor(WHITE)
        c.setFillAlpha(0.5)
        c.rect(bx, by, bw, bh, fill=1, stroke=0)
        # Windows
        c.setFillColor(AMBER)
        c.setFillAlpha(1.0)
        ww = bw * 0.2
        wh = bh * 0.18
        for row in [0.6, 0.35]:
            for col in [0.15, 0.45, 0.75]:
                c.rect(bx + bw * col, by + bh * row, ww, wh, fill=1, stroke=0)
        c.setFillAlpha(1.0)

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(CARD_W, CARD_H))

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 1 — FRONT
    # ═══════════════════════════════════════════════════════════════════════════
    _draw_chrome(c, org_name.upper(), "AUTHORISED CONTRACTOR  ·  SERVICE PROVIDER")

    # ── Photo column — top-aligned within content zone ────────────────────────
    PHOTO_X = ACCENT_W + 1.5 * mm
    PHOTO_W = 22 * mm
    PHOTO_H = 22 * mm
    PHOTO_Y = CONTENT_TOP - PHOTO_H   # flush to top of content zone

    c.setFillColor(AMBER_LIGHT)
    c.setStrokeColor(AMBER)
    c.setLineWidth(0.8)
    c.rect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, fill=1, stroke=1)

    if selfie_bytes:
        try:
            img_reader = _IR(io.BytesIO(selfie_bytes))
            c.drawImage(img_reader, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H,
                        preserveAspectRatio=False, mask="auto")
            c.setStrokeColor(AMBER)
            c.setLineWidth(1.2)
            c.rect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, fill=0, stroke=1)
        except Exception:
            c.setFillColor(AMBER)
            c.setFont("Helvetica", 6)
            c.drawCentredString(PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2 - 1 * mm, "PHOTO")
    else:
        c.setFillColor(AMBER)
        c.setFont("Helvetica", 6)
        c.drawCentredString(PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2 - 1 * mm, "PHOTO")

    # Badge number in footer under photo
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 5)
    c.drawCentredString(PHOTO_X + PHOTO_W / 2, 1.8 * mm, badge_no)

    # ── QR column ─────────────────────────────────────────────────────────────
    QR_SIZE = 16 * mm
    QR_X    = CARD_W - QR_SIZE - 2 * mm
    QR_Y    = CONTENT_BOTTOM + 1 * mm

    if qr_img_bytes:
        qr_reader = _IR(io.BytesIO(qr_img_bytes))
        c.drawImage(qr_reader, QR_X, QR_Y, QR_SIZE, QR_SIZE, preserveAspectRatio=True)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 3.8)
        c.drawCentredString(QR_X + QR_SIZE / 2, 1.6 * mm, "SCAN TO VERIFY")

    # ── Text fields (middle column, top-aligned) ───────────────────────────────
    TEXT_X     = PHOTO_X + PHOTO_W + 2 * mm
    TEXT_MAX_X = QR_X - 1.5 * mm
    TEXT_W     = TEXT_MAX_X - TEXT_X

    def draw_field(label: str, value: str, y: float, font_size: float = 7.0) -> None:
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 4.5)
        c.drawString(TEXT_X, y + font_size + 0.3, label.upper())
        c.setFillColor(DARK)
        c.setFont("Helvetica-Bold", font_size)
        avg_char_w = font_size * 0.52
        max_chars = max(1, int(TEXT_W / avg_char_w))
        v = value if len(value) <= max_chars else value[:max_chars - 1] + "…"
        c.drawString(TEXT_X, y, v)

    # Start fields below header — name label (drawn above y) must stay under CONTENT_TOP
    # name label top = F_TOP + 8pt + 0.3pt; must be <= CONTENT_TOP → F_TOP <= CONTENT_TOP - 8.3pt
    # Use 4*mm ≈ 11.3pt margin to ensure clearance
    F_TOP = CONTENT_TOP - 4 * mm
    draw_field("Name",           vendor.contact_name,  F_TOP - 0  * mm, 8.0)
    draw_field("Company",        vendor.name,           F_TOP - 8  * mm, 6.5)
    draw_field("Specialization", specialization,        F_TOP - 15 * mm, 6.0)
    draw_field("Contract",       contract_name[:32],    F_TOP - 21 * mm, 5.5)
    draw_field("Valid Until",    contract_end,          F_TOP - 27 * mm, 6.5)

    # Footer centre text
    mid_x = (PHOTO_X + PHOTO_W + QR_X) / 2
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 4)
    c.drawCentredString(mid_x, 1.8 * mm, f"Issued: {issued}  ·  Non-transferable")

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 2 — BACK
    # ═══════════════════════════════════════════════════════════════════════════
    c.showPage()
    _draw_chrome(c, org_name.upper(), "CONTRACTOR INFORMATION  ·  AUTHORISED SITES")

    BODY_X    = ACCENT_W + 3 * mm
    BODY_W    = CARD_W - BODY_X - 3 * mm
    BODY_TOP  = CONTENT_TOP - 2 * mm   # just below header band

    # ── Organisation contact block (compact, no emoji — Helvetica can't render them) ──
    y = BODY_TOP
    c.setFillColor(AMBER_DARK)
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(BODY_X, y, "ISSUING ORGANISATION")
    y -= 4 * mm

    def back_row(prefix: str, text: str) -> None:
        nonlocal y
        if not text:
            return
        c.setFillColor(DARK)
        c.setFont("Helvetica", 5)
        label = f"{prefix} {text}"
        avg_w = 5 * 0.52
        max_c = max(1, int(BODY_W / avg_w))
        if len(label) > max_c:
            label = label[:max_c - 1] + "…"
        c.drawString(BODY_X, y, label)
        y -= 3.2 * mm

    back_row("Co:", org_name)
    if org_address:
        back_row("Addr:", org_address)
    if org_phone:
        back_row("Tel:", org_phone)
    if org_email:
        back_row("Email:", org_email)

    # Divider
    y -= 0.5 * mm
    c.setStrokeColor(AMBER)
    c.setLineWidth(0.5)
    c.line(BODY_X, y, CARD_W - 3 * mm, y)
    y -= 2.5 * mm

    # ── Permitted sites ───────────────────────────────────────────────────────
    c.setFillColor(AMBER_DARK)
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(BODY_X, y, "PERMITTED SITES")
    y -= 4 * mm

    PILL_H   = 3.5 * mm
    PILL_ROW = 4.5 * mm   # row step
    SAFE_Y   = FOOTER_H + 3 * mm   # minimum y before entering footer

    if vendor.site_codes:
        col1_x = BODY_X
        col2_x = BODY_X + BODY_W / 2
        pill_w = BODY_W / 2 - 1 * mm
        shown  = 0
        row_y  = y   # y is current cursor after "PERMITTED SITES" heading

        for idx, sc in enumerate(vendor.site_codes):
            # Move down for each new row (every 2 sites)
            if idx % 2 == 0 and idx > 0:
                row_y -= PILL_ROW
            # Stop if pill bottom would overlap footer
            if row_y - PILL_H < SAFE_Y:
                break
            col_x = col1_x if idx % 2 == 0 else col2_x
            c.setFillColor(AMBER_LIGHT)
            c.setStrokeColor(AMBER)
            c.setLineWidth(0.4)
            c.roundRect(col_x, row_y - PILL_H, pill_w, PILL_H, 1 * mm, fill=1, stroke=1)
            c.setFillColor(AMBER_DARK)
            c.setFont("Helvetica-Bold", 4.5)
            c.drawCentredString(col_x + pill_w / 2, row_y - PILL_H + 1 * mm, sc)
            shown += 1

        remaining = len(vendor.site_codes) - shown
        if remaining > 0:
            overflow_y = row_y - PILL_ROW - 1 * mm
            if overflow_y >= SAFE_Y:
                c.setFillColor(GRAY)
                c.setFont("Helvetica", 4)
                c.drawString(BODY_X, overflow_y, f"+ {remaining} more — see portal for full list")
    else:
        c.setFillColor(GRAY)
        c.setFont("Helvetica", 5)
        c.drawString(BODY_X, y, "All sites under this contract")

    # ── Footer notice ─────────────────────────────────────────────────────────
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 3.8)
    c.drawCentredString(CARD_W / 2, 1.8 * mm,
        f"Badge No: {badge_no}  ·  Valid Until: {contract_end}  ·  Non-transferable")

    c.save()
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
        if vendor.cv_key:
            resp["cv_url"] = await _s3_presign(vendor.cv_key)
        if vendor.certificate_keys:
            resp["certificate_urls"] = await asyncio.gather(*[_s3_presign(k) for k in vendor.certificate_keys])
    except Exception:
        pass

    return resp


class UpdateProfilePayload(BaseModel):
    mobile: Optional[str] = None
    specialization: Optional[str] = None
    site_codes: Optional[List[str]] = None
    home_address: Optional[str] = None
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
    if payload.home_address is not None:
        vendor.home_address = payload.home_address
    if payload.gps_lat is not None:
        vendor.gps_lat = payload.gps_lat
    if payload.gps_lng is not None:
        vendor.gps_lng = payload.gps_lng
    await vendor.save()
    return _vendor_resp(vendor)


@portal_router.post("/me/regenerate-badge")
async def regenerate_badge(
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    """Force-regenerate the contractor badge PDF (picks up latest selfie + data)."""
    vendor = await _get_vendor(current_user.user_id)
    if not (vendor.selfie_key and vendor.id_front_key and vendor.id_back_key):
        raise HTTPException(status_code=400, detail="Complete KYC documents (selfie, ID front, ID back) are required before generating a badge")
    await _generate_and_store_badge(vendor)
    # Reload to get updated badge_key
    vendor = await _get_vendor(current_user.user_id)
    badge_url = await _s3_presign(vendor.badge_key) if vendor.badge_key else None
    return {"ok": True, "badge_url": badge_url}


@portal_router.post("/me/upload/{photo_type}")
async def upload_my_photo(
    photo_type: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_roles("service_provider")),
) -> dict:
    if photo_type not in ("selfie", "id_front", "id_back", "cv", "certificate"):
        raise HTTPException(status_code=400, detail="photo_type must be selfie, id_front, id_back, cv, or certificate")

    vendor = await _get_vendor(current_user.user_id)
    data = await file.read()
    content_type = file.content_type or "image/jpeg"
    ext = content_type.split("/")[-1].split("+")[0]
    if photo_type == "certificate":
        import time
        key = f"{vendor.org_id}/framework-vendors/{vendor.id}/certificates/{int(time.time())}.{ext}"
    else:
        key = f"{vendor.org_id}/framework-vendors/{vendor.id}/{photo_type}.{ext}"

    await _s3_upload(key, data, content_type)

    if photo_type == "selfie":
        vendor.selfie_key = key
    elif photo_type == "id_front":
        vendor.id_front_key = key
    elif photo_type == "id_back":
        vendor.id_back_key = key
    elif photo_type == "cv":
        vendor.cv_key = key
    else:
        vendor.certificate_keys = [*vendor.certificate_keys, key]
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
