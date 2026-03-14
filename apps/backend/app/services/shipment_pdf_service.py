"""
Waybill / Proof-of-Dispatch PDF generator — reportlab platypus.

Sections:
  1. Header band: org logo + name, "WAYBILL / PROOF OF DISPATCH", ref, date
  2. Logistics table: Tracking #, Vehicle, Driver, Destination, Receiver
  3. Items table: # | Item | Qty | UOM | Serial Numbers | Weight/unit | Line Weight
  4. Totals row
  5. Driver signature block
  6. Receiver signature block (or dashed PENDING box)
"""
from __future__ import annotations

import io
from typing import Optional

import structlog

from app.models.org import Org
from app.models.stock_shipment import StockShipment

logger = structlog.get_logger(__name__)


def _rgb(hex_str: str):
    from reportlab.lib.colors import HexColor
    return HexColor(hex_str)


_NAVY  = _rgb("#0f2a5e")
_BLUE  = _rgb("#1d4ed8")
_SLATE = _rgb("#374151")
_GRAY  = _rgb("#6b7280")
_LGRAY = _rgb("#d1d5db")
_WHITE = _rgb("#ffffff")
_BG    = _rgb("#f8fafc")


def _styles():
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
    return {
        "h1":      ParagraphStyle("h1",      fontName="Helvetica-Bold",    fontSize=14, textColor=_WHITE,  leading=18),
        "sub":     ParagraphStyle("sub",      fontName="Helvetica",         fontSize=9,  textColor=_WHITE,  leading=12),
        "label":   ParagraphStyle("label",    fontName="Helvetica",         fontSize=8,  textColor=_GRAY,   leading=11),
        "value":   ParagraphStyle("value",    fontName="Helvetica-Bold",    fontSize=9,  textColor=_SLATE,  leading=12),
        "th":      ParagraphStyle("th",       fontName="Helvetica-Bold",    fontSize=8,  textColor=_WHITE,  leading=10),
        "td":      ParagraphStyle("td",       fontName="Helvetica",         fontSize=8,  textColor=_SLATE,  leading=10),
        "td_mono": ParagraphStyle("td_mono",  fontName="Courier",           fontSize=7,  textColor=_SLATE,  leading=9),
        "sig_name":ParagraphStyle("sig_name", fontName="Helvetica-Bold",    fontSize=9,  textColor=_SLATE,  leading=12),
        "sig_meta":ParagraphStyle("sig_meta", fontName="Helvetica",         fontSize=7,  textColor=_GRAY,   leading=10),
        "pending": ParagraphStyle("pending",  fontName="Helvetica",         fontSize=10, textColor=_GRAY,   alignment=TA_CENTER),
    }


async def generate_waybill_pdf(shipment: StockShipment, org: Optional[Org]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
    )

    buf = io.BytesIO()
    W, H = A4
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=15 * mm,
    )

    st = _styles()
    content_w = W - 30 * mm
    story = []

    # ── 1. Header band ────────────────────────────────────────────────────────
    from reportlab.platypus import HRFlowable
    from reportlab.lib.styles import ParagraphStyle

    header_data = [[
        Paragraph(f"<b>{org.name if org else 'PMS'}</b><br/>"
                  f"<font size=9>{getattr(org, 'address', '') or ''}</font>", st["h1"]),
        Paragraph(
            f"WAYBILL / PROOF OF DISPATCH<br/>"
            f"<font size=9>{shipment.reference_number}</font>",
            ParagraphStyle("hr", fontName="Helvetica-Bold", fontSize=13,
                           textColor=_WHITE, alignment=1, leading=18),
        ),
    ]]
    hdr_table = Table(header_data, colWidths=[content_w * 0.5, content_w * 0.5])
    hdr_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(hdr_table)
    story.append(Spacer(1, 8 * mm))

    # ── 2. Logistics table ────────────────────────────────────────────────────
    from datetime import datetime

    def row(label: str, value: str):
        return [Paragraph(label, st["label"]), Paragraph(value or "—", st["value"])]

    date_str = shipment.created_at.strftime("%d %b %Y")
    logistics = [
        row("Date", date_str),
        row("Tracking Number", shipment.tracking_number or "—"),
        row("Vehicle Number", shipment.vehicle_number or "—"),
        row("Driver Name", shipment.driver_name),
        row("Driver Phone", shipment.driver_phone or "—"),
        row("Destination", shipment.destination),
        row("Receiver Name", shipment.receiver_name or "—"),
        row("Receiver Phone", shipment.receiver_phone or "—"),
    ]
    # Split into 2 columns
    mid = len(logistics) // 2 + len(logistics) % 2
    left_rows = logistics[:mid]
    right_rows = logistics[mid:]
    # Pad right if shorter
    while len(right_rows) < len(left_rows):
        right_rows.append(["", ""])

    log_data = []
    for l, r in zip(left_rows, right_rows):
        log_data.append(l + [Paragraph("", st["label"])] + r)

    col_w = content_w / 5
    log_table = Table(log_data, colWidths=[col_w * 0.9, col_w * 1.6, col_w * 0.1, col_w * 0.9, col_w * 1.5])
    log_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _BG),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [_BG, _WHITE]),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.3, _LGRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(log_table)
    story.append(Spacer(1, 6 * mm))

    # ── 3. Items table ────────────────────────────────────────────────────────
    items_header = [
        Paragraph("#", st["th"]),
        Paragraph("Item", st["th"]),
        Paragraph("Qty", st["th"]),
        Paragraph("UOM", st["th"]),
        Paragraph("Serial Numbers", st["th"]),
        Paragraph("Wt/unit (kg)", st["th"]),
        Paragraph("Line Wt (kg)", st["th"]),
    ]
    items_data = [items_header]
    for idx, it in enumerate(shipment.items, 1):
        serials_str = ", ".join(it.serial_numbers) if it.serial_numbers else "—"
        items_data.append([
            Paragraph(str(idx), st["td"]),
            Paragraph(it.item_name, st["td"]),
            Paragraph(f"{it.quantity:g}", st["td"]),
            Paragraph(it.unit_of_measure, st["td"]),
            Paragraph(serials_str, st["td_mono"]),
            Paragraph(f"{it.weight_per_unit:.3f}" if it.weight_per_unit else "—", st["td"]),
            Paragraph(f"{it.line_weight:.3f}" if it.line_weight else "—", st["td"]),
        ])
    # Totals row
    items_data.append([
        Paragraph("", st["td"]),
        Paragraph("<b>TOTAL</b>", st["td"]),
        Paragraph("", st["td"]),
        Paragraph("", st["td"]),
        Paragraph("", st["td"]),
        Paragraph("", st["td"]),
        Paragraph(f"<b>{shipment.total_weight:.3f} kg</b>", st["td"]),
    ])

    cw_i = content_w
    items_table = Table(items_data, colWidths=[
        cw_i * 0.05, cw_i * 0.23, cw_i * 0.07, cw_i * 0.07,
        cw_i * 0.33, cw_i * 0.12, cw_i * 0.13,
    ])
    items_table.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), _BLUE),
        ("TEXTCOLOR",  (0, 0), (-1, 0), _WHITE),
        # Totals row
        ("BACKGROUND", (0, -1), (-1, -1), _BG),
        ("FONTNAME",   (0, -1), (-1, -1), "Helvetica-Bold"),
        # Alternating rows
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [_WHITE, _BG]),
        ("GRID", (0, 0), (-1, -1), 0.3, _LGRAY),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8 * mm))

    # ── 4. Signature blocks ───────────────────────────────────────────────────
    async def _sig_block(label: str, sig, sig_key: Optional[str]):
        """Return a KeepTogether flowable for one signature block."""
        elems = [Paragraph(f"<b>{label}</b>", ParagraphStyle(
            "sh", fontName="Helvetica-Bold", fontSize=9, textColor=_NAVY, leading=13,
            borderPadding=(0, 0, 4, 0),
        ))]
        if sig and sig_key:
            # Attempt to fetch sig image from S3
            try:
                from app.core.s3 import generate_presigned_url
                sig_url = await generate_presigned_url(sig_key, expires=300)
                import httpx
                async with httpx.AsyncClient(timeout=10) as hc:
                    r = await hc.get(sig_url)
                if r.status_code == 200:
                    img_buf = io.BytesIO(r.content)
                    elems.append(Image(img_buf, width=50 * mm, height=20 * mm))
            except Exception:
                pass
            elems.append(Paragraph(sig.signed_by_name, st["sig_name"]))
            elems.append(Paragraph(
                f"Signed: {sig.signed_at.strftime('%d %b %Y %H:%M UTC')} · IP: {sig.ip_address or '—'}",
                st["sig_meta"],
            ))
        else:
            # Dashed pending box
            pending_data = [[Paragraph("PENDING SIGNATURE", st["pending"])]]
            pending_t = Table(pending_data, colWidths=[content_w * 0.45])
            pending_t.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 1, _LGRAY),
                ("LINEBELOW", (0, 0), (-1, -1), 1, _LGRAY),
                ("TOPPADDING",    (0, 0), (-1, -1), 20),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 20),
            ]))
            elems.append(pending_t)
        return KeepTogether(elems)

    driver_block = await _sig_block(
        "DRIVER SIGNATURE (Proof of Dispatch)",
        shipment.driver_signature,
        shipment.driver_signature.signature_key if shipment.driver_signature else None,
    )
    receiver_block = await _sig_block(
        "RECEIVER SIGNATURE (Proof of Delivery)",
        shipment.receiver_signature,
        shipment.receiver_signature.signature_key if shipment.receiver_signature else None,
    )

    sig_data = [[driver_block, receiver_block]]
    sig_table = Table(sig_data, colWidths=[content_w * 0.49, content_w * 0.49], hAlign="LEFT",
                      spaceBefore=2 * mm, spaceAfter=0)
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("COLSPACING", (0, 0), (0, -1), 6 * mm),
    ]))
    story.append(sig_table)

    # Footer note
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        f"This document was generated by PMS on {shipment.created_at.strftime('%d %b %Y')}. "
        f"Reference: {shipment.reference_number}.",
        ParagraphStyle("footer", fontName="Helvetica", fontSize=7, textColor=_GRAY, leading=9),
    ))

    doc.build(story)
    return buf.getvalue()
