"""Shipment service — create waybill, driver/receiver signing, PDF generation."""
from __future__ import annotations

import base64
import secrets
from typing import Optional

from fastapi import HTTPException, Request

from app.core.config import settings
from app.core.email import send_email, shipment_driver_sign_html, shipment_receiver_sign_html
from app.core.s3 import generate_presigned_url, upload_file
from app.dependencies.auth import CurrentUser
from app.models.org import Org
from app.models.stock_shipment import ShipmentItem, ShipmentSignature, StockShipment
from app.repositories.inventory_repository import shipment_repository
from app.schemas.inventory import (
    ShipmentCreateRequest,
    ShipmentItemResponse,
    ShipmentListResponse,
    ShipmentPublicContext,
    ShipmentResponse,
    ShipmentSignRequest,
    ShipmentSignatureResponse,
)
from app.utils.datetime import utc_now


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sign_url(token: str, role: str) -> str:
    base = (settings.app_base_url or "http://localhost:5173").rstrip("/")
    return f"{base}/shipment-sign/{token}?role={role}"


def _item_to_response(i: ShipmentItem) -> ShipmentItemResponse:
    return ShipmentItemResponse(
        id=i.id,
        item_id=i.item_id,
        item_name=i.item_name,
        quantity=i.quantity,
        unit_of_measure=i.unit_of_measure,
        serial_numbers=i.serial_numbers,
        weight_per_unit=i.weight_per_unit,
        line_weight=i.line_weight,
    )


def _sig_to_response(sig: ShipmentSignature) -> ShipmentSignatureResponse:
    return ShipmentSignatureResponse(
        signed_by_name=sig.signed_by_name,
        signed_at=sig.signed_at,
        ip_address=sig.ip_address,
        signature_key=sig.signature_key,
    )


def _to_response(s: StockShipment, driver_sign_url: Optional[str] = None,
                 receiver_sign_url: Optional[str] = None,
                 pdf_url: Optional[str] = None) -> ShipmentResponse:
    return ShipmentResponse(
        id=str(s.id),
        org_id=s.org_id,
        reference_number=s.reference_number,
        movement_type=s.movement_type,
        items=[_item_to_response(i) for i in s.items],
        total_weight=s.total_weight,
        tracking_number=s.tracking_number,
        driver_name=s.driver_name,
        driver_phone=s.driver_phone,
        driver_email=s.driver_email,
        vehicle_number=s.vehicle_number,
        destination=s.destination,
        receiver_name=s.receiver_name,
        receiver_phone=s.receiver_phone,
        receiver_email=s.receiver_email,
        status=s.status,
        driver_sign_token=s.driver_sign_token,
        driver_signature=_sig_to_response(s.driver_signature) if s.driver_signature else None,
        receiver_sign_token=s.receiver_sign_token,
        receiver_signature=_sig_to_response(s.receiver_signature) if s.receiver_signature else None,
        pdf_key=s.pdf_key,
        notes=s.notes,
        created_by=s.created_by,
        created_at=s.created_at,
        updated_at=s.updated_at,
        driver_sign_url=driver_sign_url,
        receiver_sign_url=receiver_sign_url,
        pdf_url=pdf_url,
    )


async def _get_org(org_id: str) -> Optional[Org]:
    return await Org.find_one(Org.org_id == org_id)


async def _generate_pdf(shipment: StockShipment, org: Optional[Org]) -> None:
    from app.services.shipment_pdf_service import generate_waybill_pdf
    pdf_bytes = await generate_waybill_pdf(shipment, org)
    key = f"{shipment.org_id}/shipment_pdfs/{str(shipment.id)}/waybill.pdf"
    await upload_file(key, pdf_bytes, "application/pdf")
    await shipment_repository.update(shipment, {"pdf_key": key})


# ── Service methods ───────────────────────────────────────────────────────────

async def create_shipment(
    request: ShipmentCreateRequest,
    current_user: CurrentUser,
) -> ShipmentResponse:
    ref = await shipment_repository.next_reference_number(current_user.org_id)

    items = []
    total_weight = 0.0
    for ri in request.items:
        wpk = ri.weight_per_unit or 0.0
        lw = wpk * ri.quantity
        total_weight += lw
        items.append(ShipmentItem(
            item_id=ri.item_id,
            item_name=ri.item_name,
            quantity=ri.quantity,
            unit_of_measure=ri.unit_of_measure,
            serial_numbers=ri.serial_numbers,
            weight_per_unit=ri.weight_per_unit,
            line_weight=lw,
        ))

    driver_token = secrets.token_urlsafe(32)
    shipment = StockShipment(
        org_id=current_user.org_id,
        reference_number=ref,
        movement_type=request.movement_type,
        items=items,
        total_weight=total_weight,
        tracking_number=request.tracking_number,
        driver_name=request.driver_name,
        driver_phone=request.driver_phone,
        driver_email=request.driver_email,
        vehicle_number=request.vehicle_number,
        destination=request.destination,
        receiver_name=request.receiver_name,
        receiver_phone=request.receiver_phone,
        receiver_email=request.receiver_email,
        status="pending_driver",
        driver_sign_token=driver_token,
        notes=request.notes,
        created_by=current_user.user_id,
    )
    await shipment_repository.create(shipment)

    d_url = _sign_url(driver_token, "driver")
    org = await _get_org(current_user.org_id)
    org_name = org.name if org else "PMS"

    if request.driver_email:
        await send_email(
            to=request.driver_email,
            subject=f"Please sign waybill {ref}",
            html=shipment_driver_sign_html(
                driver_name=request.driver_name,
                sign_url=d_url,
                reference_number=ref,
                destination=request.destination,
                org_name=org_name,
            ),
        )

    return _to_response(shipment, driver_sign_url=d_url)


async def get_shipment(shipment_id: str, current_user: CurrentUser) -> ShipmentResponse:
    s = await shipment_repository.get_by_id(shipment_id, current_user.org_id)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "SHIPMENT_NOT_FOUND", "message": "Shipment not found"})
    d_url = _sign_url(s.driver_sign_token, "driver") if s.driver_sign_token else None
    r_url = _sign_url(s.receiver_sign_token, "receiver") if s.receiver_sign_token else None
    return _to_response(s, driver_sign_url=d_url, receiver_sign_url=r_url)


async def list_shipments(
    current_user: CurrentUser,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> ShipmentListResponse:
    items, total = await shipment_repository.list(current_user.org_id, status, page, page_size)
    return ShipmentListResponse(
        items=[_to_response(s) for s in items],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_shipment_pdf_url(shipment_id: str, current_user: CurrentUser) -> str:
    s = await shipment_repository.get_by_id(shipment_id, current_user.org_id)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "SHIPMENT_NOT_FOUND", "message": "Shipment not found"})
    if not s.pdf_key:
        raise HTTPException(status_code=404, detail={"code": "PDF_NOT_READY", "message": "PDF not yet generated"})
    return await generate_presigned_url(s.pdf_key, expires=900)


# ── Public sign endpoints ─────────────────────────────────────────────────────

async def get_driver_sign_context(token: str) -> ShipmentPublicContext:
    s = await shipment_repository.get_by_driver_token(token)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "TOKEN_INVALID", "message": "Invalid or expired token"})
    org = await _get_org(s.org_id)
    org_name = org.name if org else None
    org_logo = None
    if org and getattr(org, "logo_key", None):
        try:
            org_logo = await generate_presigned_url(org.logo_key)
        except Exception:
            pass
    return ShipmentPublicContext(
        reference_number=s.reference_number,
        movement_type=s.movement_type,
        tracking_number=s.tracking_number,
        vehicle_number=s.vehicle_number,
        driver_name=s.driver_name,
        destination=s.destination,
        receiver_name=s.receiver_name,
        items=[_item_to_response(i) for i in s.items],
        total_weight=s.total_weight,
        status=s.status,
        org_name=org_name,
        org_logo_url=org_logo,
        notes=s.notes,
    )


async def sign_driver(token: str, request: ShipmentSignRequest, ip: Optional[str] = None) -> dict:
    s = await shipment_repository.get_by_driver_token(token)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "TOKEN_INVALID", "message": "Invalid or expired token"})
    if s.status not in ("pending_driver",):
        raise HTTPException(status_code=409, detail={"code": "ALREADY_SIGNED", "message": "Driver already signed"})

    # Decode and upload signature PNG
    try:
        sig_data = request.signature_b64
        if sig_data.startswith("data:"):
            sig_data = sig_data.split(",", 1)[1]
        sig_bytes = base64.b64decode(sig_data)
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SIGNATURE", "message": "Could not decode signature"})

    key = f"{s.org_id}/shipment_sigs/{str(s.id)}/driver.png"
    await upload_file(key, sig_bytes, "image/png")

    sig = ShipmentSignature(
        signed_by_name=request.signed_by_name,
        signed_at=utc_now(),
        ip_address=ip,
        signature_key=key,
    )

    updates: dict = {"driver_signature": sig, "driver_sign_token": None}

    org = await _get_org(s.org_id)
    org_name = org.name if org else "PMS"

    if s.receiver_email:
        recv_token = secrets.token_urlsafe(32)
        r_url = _sign_url(recv_token, "receiver")
        updates["receiver_sign_token"] = recv_token
        updates["status"] = "pending_receiver"
        await send_email(
            to=s.receiver_email,
            subject=f"Confirm delivery of shipment {s.reference_number}",
            html=shipment_receiver_sign_html(
                receiver_name=s.receiver_name or "Receiver",
                sign_url=r_url,
                driver_name=s.driver_name,
                reference_number=s.reference_number,
                org_name=org_name,
            ),
        )
    else:
        updates["status"] = "delivered"

    await shipment_repository.update(s, updates)

    if updates.get("status") == "delivered":
        await _generate_pdf(s, org)

    return {"ok": True, "status": updates["status"]}


async def get_receiver_sign_context(token: str) -> ShipmentPublicContext:
    s = await shipment_repository.get_by_receiver_token(token)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "TOKEN_INVALID", "message": "Invalid or expired token"})
    org = await _get_org(s.org_id)
    org_name = org.name if org else None
    org_logo = None
    if org and getattr(org, "logo_key", None):
        try:
            org_logo = await generate_presigned_url(org.logo_key)
        except Exception:
            pass
    return ShipmentPublicContext(
        reference_number=s.reference_number,
        movement_type=s.movement_type,
        tracking_number=s.tracking_number,
        vehicle_number=s.vehicle_number,
        driver_name=s.driver_name,
        destination=s.destination,
        receiver_name=s.receiver_name,
        items=[_item_to_response(i) for i in s.items],
        total_weight=s.total_weight,
        status=s.status,
        org_name=org_name,
        org_logo_url=org_logo,
        notes=s.notes,
    )


async def sign_receiver(token: str, request: ShipmentSignRequest, ip: Optional[str] = None) -> dict:
    s = await shipment_repository.get_by_receiver_token(token)
    if not s:
        raise HTTPException(status_code=404, detail={"code": "TOKEN_INVALID", "message": "Invalid or expired token"})
    if s.status not in ("pending_receiver", "driver_signed"):
        raise HTTPException(status_code=409, detail={"code": "ALREADY_SIGNED", "message": "Receiver already signed"})

    try:
        sig_data = request.signature_b64
        if sig_data.startswith("data:"):
            sig_data = sig_data.split(",", 1)[1]
        sig_bytes = base64.b64decode(sig_data)
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SIGNATURE", "message": "Could not decode signature"})

    key = f"{s.org_id}/shipment_sigs/{str(s.id)}/receiver.png"
    await upload_file(key, sig_bytes, "image/png")

    sig = ShipmentSignature(
        signed_by_name=request.signed_by_name,
        signed_at=utc_now(),
        ip_address=ip,
        signature_key=key,
    )

    await shipment_repository.update(s, {
        "receiver_signature": sig,
        "receiver_sign_token": None,
        "status": "delivered",
    })

    org = await _get_org(s.org_id)
    await _generate_pdf(s, org)

    return {"ok": True, "status": "delivered"}
