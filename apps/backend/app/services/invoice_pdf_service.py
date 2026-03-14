"""
Professional invoice PDF generator — reportlab platypus.

Page 1: Header · Bill To/Invoice Details · Line Items · Totals ·
        Tiered Breakdown (optional) · Meter Evidence · Payment Details
Page 2: Utility Usage History grid + Analytics
"""
from __future__ import annotations

import io
from typing import Dict, List, Optional, Tuple

import structlog

from app.models.invoice import Invoice, InvoiceLineItem
from app.models.property import BillingSettings, Property, PricingTier, UtilityDetail

logger = structlog.get_logger(__name__)

# ── Palette ───────────────────────────────────────────────────────────────────
def _rgb(hex_str: str):
    from reportlab.lib.colors import HexColor
    return HexColor(hex_str)

_NAVY   = _rgb("#0f2a5e")
_BLUE   = _rgb("#1d4ed8")
_SLATE  = _rgb("#374151")
_GRAY   = _rgb("#6b7280")
_LGRAY  = _rgb("#d1d5db")
_BG     = _rgb("#f8fafc")
_GREEN  = _rgb("#059669")
_RED    = _rgb("#dc2626")
_AMBER  = _rgb("#d97706")
_WHITE  = _rgb("#ffffff")
_HEADER = _rgb("#0f2a5e")      # same as navy for header band


def _money(amount: float, currency: str = "KES") -> str:
    return f"{currency} {amount:,.2f}"


def _usage(value: float, unit: str = "") -> str:
    s = f"{value:,.2f}"
    return f"{s} {unit}".strip() if unit else s


# ── Style helpers ─────────────────────────────────────────────────────────────
def _styles():
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
    return {
        "h1":      ParagraphStyle("h1",  fontName="Helvetica-Bold",  fontSize=22, textColor=_WHITE,  leading=26),
        "h2":      ParagraphStyle("h2",  fontName="Helvetica-Bold",  fontSize=13, textColor=_NAVY,   leading=18, spaceAfter=4),
        "h3":      ParagraphStyle("h3",  fontName="Helvetica-Bold",  fontSize=10, textColor=_SLATE,  leading=14, spaceAfter=2),
        "body":    ParagraphStyle("body", fontName="Helvetica",       fontSize=9,  textColor=_SLATE,  leading=13),
        "small":   ParagraphStyle("small", fontName="Helvetica",      fontSize=8,  textColor=_GRAY,   leading=12),
        "bold":    ParagraphStyle("bold", fontName="Helvetica-Bold",  fontSize=9,  textColor=_SLATE,  leading=13),
        "right":   ParagraphStyle("right", fontName="Helvetica",      fontSize=9,  textColor=_SLATE,  leading=13, alignment=TA_RIGHT),
        "bold_r":  ParagraphStyle("bold_r", fontName="Helvetica-Bold", fontSize=9, textColor=_SLATE,  leading=13, alignment=TA_RIGHT),
        "big_r":   ParagraphStyle("big_r", fontName="Helvetica-Bold", fontSize=11, textColor=_NAVY,   leading=15, alignment=TA_RIGHT),
        "tag":     ParagraphStyle("tag",  fontName="Helvetica-Bold",  fontSize=32, textColor=_rgb("#cdd9f5"), alignment=TA_RIGHT),
        "section": ParagraphStyle("sect", fontName="Helvetica-Bold",  fontSize=10, textColor=_NAVY,   leading=14, spaceBefore=10, spaceAfter=4),
        "center":  ParagraphStyle("ctr",  fontName="Helvetica",       fontSize=8,  textColor=_GRAY,   leading=12, alignment=TA_CENTER),
        "th":      ParagraphStyle("th",   fontName="Helvetica-Bold",  fontSize=8,  textColor=_WHITE,  leading=12),
        "td":      ParagraphStyle("td",   fontName="Helvetica",       fontSize=8,  textColor=_SLATE,  leading=12),
        "td_r":    ParagraphStyle("td_r", fontName="Helvetica",       fontSize=8,  textColor=_SLATE,  leading=12, alignment=TA_RIGHT),
        "td_rb":   ParagraphStyle("td_rb", fontName="Helvetica-Bold", fontSize=8,  textColor=_NAVY,   leading=12, alignment=TA_RIGHT),
        "num":     ParagraphStyle("num",  fontName="Helvetica",       fontSize=9,  textColor=_NAVY,   leading=13),
    }


def _tbl_style(extra=None):
    from reportlab.platypus import TableStyle
    base = [
        ("BACKGROUND",  (0, 0), (-1, 0), _NAVY),
        ("TEXTCOLOR",   (0, 0), (-1, 0), _WHITE),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_WHITE, _BG]),
        ("FONTNAME",    (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",    (0, 1), (-1, -1), 8),
        ("GRID",        (0, 0), (-1, -1), 0.3, _LGRAY),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    if extra:
        base.extend(extra)
    return TableStyle(base)


# ── Image download helper ─────────────────────────────────────────────────────
async def _fetch_images(keys: List[str]) -> Dict[str, bytes]:
    """Download S3 objects in parallel; skip failures."""
    if not keys:
        return {}
    from app.core.s3 import download_file
    import asyncio

    async def _try(key):
        try:
            return key, await download_file(key)
        except Exception:
            return key, None

    results = await asyncio.gather(*[_try(k) for k in keys])
    return {k: v for k, v in results if v is not None}


# ── Tier calculation ──────────────────────────────────────────────────────────
def _calc_tiers(consumption: float, tiers: List[PricingTier]) -> List[Tuple[str, float, float, float]]:
    """Return list of (band_label, units_in_band, rate, subtotal)."""
    rows: List[Tuple[str, float, float, float]] = []
    remaining = consumption
    for tier in tiers:
        if remaining <= 0:
            break
        lower = tier.from_units
        upper = tier.to_units
        if upper is None:
            band = remaining
        else:
            band = min(remaining, upper - lower)
        if band <= 0:
            continue
        if upper is None:
            label = f"{lower:g}+ units"
        else:
            label = f"{lower:g}–{upper:g} units"
        rows.append((label, band, tier.rate, band * tier.rate))
        remaining -= band
    return rows


# ── Page canvas callbacks ─────────────────────────────────────────────────────
def _draw_header_band(canvas, doc, property_name: str, address: str, reference_no: str):
    """Draw the navy header band on every first page."""
    from reportlab.lib.units import mm
    w, h = doc.pagesize
    band_h = 55 * mm
    canvas.saveState()
    canvas.setFillColor(_NAVY)
    canvas.rect(0, h - band_h, w, band_h, fill=1, stroke=0)
    # Property name
    canvas.setFillColor(_WHITE)
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(20 * mm, h - 22 * mm, property_name)
    # Address
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(_rgb("#adc6f0"))
    canvas.drawString(20 * mm, h - 30 * mm, address)
    # "INVOICE" watermark text (right side)
    canvas.setFont("Helvetica-Bold", 36)
    canvas.setFillColor(_rgb("#1e3a8a"))
    canvas.drawRightString(w - 20 * mm, h - 25 * mm, "INVOICE")
    # Reference number (right, below)
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(_rgb("#93c5fd"))
    canvas.drawRightString(w - 20 * mm, h - 36 * mm, reference_no)
    canvas.restoreState()


def _draw_page_number(canvas, doc):
    from reportlab.lib.units import mm
    w, h = doc.pagesize
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(_GRAY)
    canvas.drawCentredString(w / 2, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _draw_footer_line(canvas, doc, org_name: str = ""):
    from reportlab.lib.units import mm
    w, h = doc.pagesize
    canvas.saveState()
    canvas.setStrokeColor(_LGRAY)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 15 * mm, w - 20 * mm, 15 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(_GRAY)
    canvas.drawCentredString(w / 2, 11 * mm, f"{org_name}  ·  Generated by PMS Portal  ·  Page {doc.page}")
    canvas.restoreState()


# ── Main builder ──────────────────────────────────────────────────────────────
async def build_invoice_pdf(
    invoice: Invoice,
    property_obj: Property,
    tenant_name: str,
    unit_label: str,
    org_name: str = "",
    currency: str = "KES",
    usage_history: Optional[List[Invoice]] = None,
) -> bytes:
    """Build the full invoice PDF and return raw bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import (
        BaseDocTemplate, Frame, PageBreak, PageTemplate,
        Paragraph, Spacer, Table, TableStyle, KeepTogether,
        HRFlowable,
    )
    from reportlab.platypus import Image as RLImage

    S = _styles()
    page_w, page_h = A4
    left_m = right_m = 20 * mm
    top_m = 65 * mm   # leave room for the navy header band
    bottom_m = 22 * mm

    prop = property_obj
    billing = prop.billing_settings
    payment = prop.payment_config
    addr_parts = [prop.address.street, prop.address.city, prop.address.state, prop.address.country]
    address_str = ", ".join(p for p in addr_parts if p)

    def _on_first_page(c, d):
        _draw_header_band(c, d, prop.name, address_str, invoice.reference_no)
        _draw_footer_line(c, d, org_name)

    def _on_later_pages(c, d):
        _draw_footer_line(c, d, org_name)

    # Download meter images
    meter_keys = [
        li.meter_image_key
        for li in invoice.line_items
        if li.meter_image_key and li.type == "metered_utility"
    ]
    img_data = await _fetch_images(meter_keys)

    story: list = []

    # ── Bill To / Invoice Details (two-column layout via Table) ───────────────
    billing_month_pretty = _fmt_billing_month(invoice.billing_month)
    due_date_str = str(invoice.due_date) if invoice.due_date else "—"
    sent_str = invoice.sent_at.strftime("%d %b %Y") if invoice.sent_at else "—"

    bill_to_lines = [
        Paragraph("BILL TO", ParagraphStyle("lbl", fontName="Helvetica-Bold", fontSize=7,
                                             textColor=_GRAY, leading=10, spaceAfter=4)),
        Paragraph(tenant_name or "—", S["h3"]),
        Paragraph(f"Unit: {unit_label or '—'}", S["body"]),
        Paragraph(prop.name, S["body"]),
    ]
    inv_detail_lines = [
        _detail_row("Invoice #",      invoice.reference_no,        S),
        _detail_row("Billing Month",  billing_month_pretty,         S),
        _detail_row("Due Date",       due_date_str,                 S),
        _detail_row("Status",         invoice.status.replace("_", " ").title(), S),
        _detail_row("Sent",           sent_str,                     S),
    ]

    header_tbl = Table(
        [[bill_to_lines, inv_detail_lines]],
        colWidths=[(page_w - left_m - right_m) * 0.50, (page_w - left_m - right_m) * 0.50],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 5 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_LGRAY))
    story.append(Spacer(1, 4 * mm))

    # ── Line items table ──────────────────────────────────────────────────────
    story.append(Paragraph("Line Items", S["section"]))

    col_w = page_w - left_m - right_m
    li_cols = [col_w * 0.42, col_w * 0.13, col_w * 0.15, col_w * 0.15, col_w * 0.15]
    li_head = [
        [Paragraph(h, S["th"]) for h in ("Description", "Type", "Qty", "Rate", "Amount")]
    ]
    li_rows = []
    for li in invoice.line_items:
        type_label = _type_label(li.type)
        li_rows.append([
            Paragraph(li.description, S["td"]),
            Paragraph(type_label, S["td"]),
            Paragraph(_usage(li.quantity), S["td_r"]),
            Paragraph(_money(li.unit_price, ""), S["td_r"]),
            Paragraph(_money(li.amount, ""), S["td_r"]),
        ])

    li_tbl = Table(li_head + li_rows, colWidths=li_cols, repeatRows=1)
    li_tbl.setStyle(_tbl_style([
        ("ALIGN", (2, 0), (4, -1), "RIGHT"),
    ]))
    story.append(li_tbl)
    story.append(Spacer(1, 4 * mm))

    # ── Totals ────────────────────────────────────────────────────────────────
    story.append(_build_totals(invoice, currency, S, col_w))
    story.append(Spacer(1, 5 * mm))

    # Evidence items collected for page 2 (photos moved off page 1 for neatness)
    evidence_items = [li for li in invoice.line_items if li.meter_image_key]

    # ── Payment instructions ──────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.4, color=_LGRAY))
    story.append(Paragraph("Payment Instructions", S["section"]))
    story.append(_build_payment_block(payment, unit_label or invoice.reference_no, currency, S))

    if invoice.notes:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph("Notes", S["section"]))
        story.append(Paragraph(invoice.notes, S["body"]))

    # ── Annex A: Tiered Rate Calculation (always shown for metered items with tiers) ──
    tiered_items = [
        li for li in invoice.line_items
        if li.type == "metered_utility"
        and li.status == "confirmed"
        and li.tiers
        and li.current_reading is not None
        and li.previous_reading is not None
    ]
    if tiered_items:
        story.append(PageBreak())
        story.append(Paragraph("Annex A — Tiered Rate Calculation", S["h2"]))
        story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(
            "The following tables show the step-by-step workings for each metered utility "
            "charged on a tiered rate schedule.",
            S["body"],
        ))
        story.append(Spacer(1, 4 * mm))
        for li in tiered_items:
            consumption = (li.current_reading or 0) - (li.previous_reading or 0)
            # Use snapshot tiers stored on the line item (not live property tiers)
            tier_rows = _calc_tiers(consumption, li.tiers)
            if tier_rows:
                story.append(Paragraph(li.description, S["bold"]))
                prev = li.previous_reading or 0
                story.append(Paragraph(
                    f"Previous reading: {prev:g}  ·  Current reading: {li.current_reading:g}  "
                    f"·  Consumption: {consumption:,.2f} units",
                    S["small"],
                ))
                story.append(Spacer(1, 1 * mm))
                story.append(_build_tier_table(tier_rows, li, currency, S, col_w))
                story.append(Spacer(1, 4 * mm))

    # ── Page 2: Usage charts + Photo Evidence (always shown) ─────────────────
    history = [
        inv for inv in (usage_history or [])
        if inv.id != invoice.id and inv.status != "void"
    ]
    story.append(PageBreak())
    story.extend(_build_history_page(invoice, history, prop, currency, S, col_w, img_data, evidence_items))

    # ── Assemble document ─────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=left_m,
        rightMargin=right_m,
        topMargin=top_m,
        bottomMargin=bottom_m,
    )
    frame1 = Frame(left_m, bottom_m, page_w - left_m - right_m,
                   page_h - top_m - bottom_m, id="first")
    frame_rest = Frame(left_m, bottom_m, page_w - left_m - right_m,
                       page_h - 25 * mm - bottom_m, id="rest")

    tmpl1 = PageTemplate(id="first", frames=[frame1], onPage=_on_first_page)
    tmpl2 = PageTemplate(id="later", frames=[frame_rest], onPage=_on_later_pages)
    doc.addPageTemplates([tmpl1, tmpl2])
    doc.build(story)

    return buf.getvalue()


# ── Helper builders ───────────────────────────────────────────────────────────
def _detail_row(label: str, value: str, S) -> Table:
    from reportlab.platypus import Paragraph, Table, TableStyle as TS
    tbl = Table(
        [[Paragraph(label, S["small"]), Paragraph(value, S["bold"])]],
        colWidths=["35%", "65%"],
    )
    tbl.setStyle(TS([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return tbl


def _build_totals(invoice: Invoice, currency: str, S, col_w: float):
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle as TS
    rows = [
        ("Subtotal",       _money(invoice.subtotal, currency)),
    ]
    if invoice.tax_amount:
        rows.append(("Tax", _money(invoice.tax_amount, currency)))
    if invoice.carried_forward:
        rows.append(("Carried Forward", _money(invoice.carried_forward, currency)))
    rows.append(("TOTAL", _money(invoice.total_amount, currency)))
    rows.append(("Amount Paid", _money(invoice.amount_paid, currency)))
    rows.append(("Balance Due", _money(invoice.balance_due, currency)))

    half = col_w * 0.5
    tbl_data = [
        [Paragraph(""), Paragraph(label, S["right"]), Paragraph(val, S["bold_r"])]
        for label, val in rows[:-2]
    ] + [
        ["", Paragraph("TOTAL", S["bold_r"]), Paragraph(_money(invoice.total_amount, currency), S["big_r"])],
        ["", Paragraph("Amount Paid", S["right"]), Paragraph(_money(invoice.amount_paid, currency), S["right"])],
        ["", Paragraph("Balance Due", S["right"]), Paragraph(_money(invoice.balance_due, currency),
            ParagraphStyle("bd", fontName="Helvetica-Bold", fontSize=11,
                           textColor=_GREEN if invoice.balance_due == 0 else _RED,
                           leading=15, alignment=2))],
    ]

    tbl = Table(tbl_data, colWidths=[col_w * 0.50, col_w * 0.26, col_w * 0.24])
    style = TS([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEABOVE", (1, -3), (2, -3), 0.5, _NAVY),
        ("LINEABOVE", (1, -1), (2, -1), 0.5, _LGRAY),
    ])
    tbl.setStyle(style)
    return tbl


def _build_tier_table(rows, li: InvoiceLineItem, currency: str, S, col_w: float):
    from reportlab.platypus import Table, TableStyle as TS

    consumption = (li.current_reading or 0) - (li.previous_reading or 0)
    head = [["Band", "Units", f"Rate ({currency})", f"Sub-total ({currency})"]]
    data_rows = [[r[0], f"{r[1]:,.2f}", f"{r[2]:,.4f}", f"{r[3]:,.2f}"] for r in rows]
    total_row = [["", f"Total: {consumption:,.2f}", "", f"{li.amount:,.2f}"]]

    tbl = Table(
        head + data_rows + total_row,
        colWidths=[col_w * 0.38, col_w * 0.18, col_w * 0.22, col_w * 0.22],
    )
    tbl.setStyle(_tbl_style([
        ("SPAN", (0, -1), (1, -1)),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), _BG),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
    ]))
    return tbl


def _build_payment_block(payment, account_ref: str, currency: str, S):
    from reportlab.platypus import Paragraph, Table, TableStyle as TS

    lines = []
    if payment:
        if payment.paybill_number:
            lines.append(f"M-Pesa Paybill: {payment.paybill_number}  ·  Account: {account_ref}")
        if payment.till_number:
            lines.append(f"M-Pesa Till: {payment.till_number}")
        if payment.bank_name:
            lines.append(f"Bank: {payment.bank_name}  ·  A/C: {payment.bank_account or '—'}  ·  Branch: {payment.bank_branch or '—'}")
    if not lines:
        lines.append("Please contact your property manager for payment details.")

    rows = [[Paragraph(line, S["body"])] for line in lines]
    tbl = Table(rows, colWidths=["100%"])
    tbl.setStyle(TS([
        ("BACKGROUND", (0, 0), (-1, -1), _BG),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.3, _LGRAY),
    ]))
    return tbl


def _build_chart_drawing(months_vals: list, width: float, height: float):
    """Return a reportlab Drawing with a bar chart, or a placeholder if no data."""
    from reportlab.graphics.shapes import Drawing, Rect, String
    d = Drawing(width, height)
    if not months_vals:
        d.add(Rect(1, 1, width - 2, height - 2, fillColor=_BG, strokeColor=_LGRAY, strokeWidth=0.4))
        d.add(String(width / 2, height / 2 - 4, "No data available",
                     fontSize=7, fillColor=_GRAY, textAnchor="middle"))
        return d
    try:
        from reportlab.graphics.charts.barcharts import VerticalBarChart
        chart = VerticalBarChart()
        chart.x = 24
        chart.y = 18
        chart.width = width - 30
        chart.height = height - 26
        chart.data = [[v for _, v in months_vals]]
        labels = []
        for m, _ in months_vals:
            try:
                y, mo = int(m[:4]), int(m[5:7])
                from datetime import date as _d
                labels.append(_d(y, mo, 1).strftime("%b"))
            except Exception:
                labels.append(m[-5:])
        chart.categoryAxis.categoryNames = labels
        chart.categoryAxis.labels.fontSize = 5
        chart.categoryAxis.labels.angle = 30
        chart.categoryAxis.labels.dy = -6
        chart.categoryAxis.labels.boxAnchor = "ne"
        chart.valueAxis.labels.fontSize = 5
        chart.valueAxis.valueMin = 0
        chart.bars[0].fillColor = _BLUE
        chart.bars[0].strokeWidth = 0
        chart.strokeColor = None
        d.add(chart)
    except Exception:
        from reportlab.graphics.shapes import String
        d.add(String(width / 2, height / 2 - 4, "Chart unavailable",
                     fontSize=7, fillColor=_GRAY, textAnchor="middle"))
    return d


def _build_chart_card(title: str, months_vals: list, unit_str: str,
                       card_w: float, card_h: float, S):
    """Return a styled Table card containing a bar chart."""
    from reportlab.platypus import Paragraph, Table, TableStyle as TS
    from reportlab.lib.units import mm
    if months_vals:
        vals = [v for _, v in months_vals]
        avg = sum(vals) / len(vals)
        peak = max(vals)
        u = f" {unit_str}" if unit_str else ""
        stats = f"Avg {avg:,.1f}{u}  ·  Peak {peak:,.1f}{u}"
    else:
        stats = "No data available"
    drawing = _build_chart_drawing(months_vals, card_w - 10, card_h - 30)
    data = [
        [Paragraph(title, S["th"])],
        [drawing],
        [Paragraph(stats, S["center"])],
    ]
    t = Table(data, colWidths=[card_w])
    t.setStyle(TS([
        ("BACKGROUND", (0, 0), (0, 0), _NAVY),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (0, 0), 5),
        ("BOTTOMPADDING", (0, 0), (0, 0), 5),
        ("TOPPADDING", (0, 1), (0, 1), 3),
        ("BOTTOMPADDING", (0, 1), (0, 1), 3),
        ("TOPPADDING", (0, 2), (0, 2), 4),
        ("BOTTOMPADDING", (0, 2), (0, 2), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("BOX", (0, 0), (0, -1), 0.5, _LGRAY),
    ]))
    return t


def _build_evidence_card(evidence_items: list, img_data: dict,
                          card_w: float, card_h: float, S):
    """Return a styled card Table with meter photo evidence or placeholder."""
    import io as _io
    from reportlab.platypus import Paragraph, Table, TableStyle as TS
    from reportlab.platypus import Image as RLImage
    from reportlab.graphics.shapes import Drawing, Rect, String

    valid = [li for li in evidence_items if li.meter_image_key and li.meter_image_key in img_data]
    if not valid:
        d = Drawing(card_w - 10, card_h - 30)
        d.add(Rect(1, 1, card_w - 12, card_h - 32,
                   fillColor=_BG, strokeColor=_LGRAY, strokeWidth=0.4))
        d.add(String((card_w - 10) / 2, (card_h - 30) / 2 - 4, "No photos captured",
                     fontSize=7, fillColor=_GRAY, textAnchor="middle"))
        body = d
        stats = "—"
    else:
        img_w = (card_w - 20) / 2
        img_h = img_w * 0.65
        cells, captions = [], []
        for li in valid[:4]:
            try:
                rl_img = RLImage(_io.BytesIO(img_data[li.meter_image_key]),
                                 width=img_w, height=img_h, kind="proportional")
                cap = li.description[:18]
                if li.current_reading is not None:
                    cap += f" →{li.current_reading:g}"
                cells.append(rl_img)
                captions.append(Paragraph(cap, S["small"]))
            except Exception:
                pass
        if not cells:
            body, stats = Paragraph("Photos unavailable", S["center"]), "—"
        else:
            # Pair into 2-col rows
            img_rows = []
            for i in range(0, len(cells), 2):
                pair_img = cells[i:i + 2]
                pair_cap = captions[i:i + 2]
                if len(pair_img) == 1:
                    pair_img.append(Paragraph("", S["small"]))
                    pair_cap.append(Paragraph("", S["small"]))
                img_rows.append(pair_img)
                img_rows.append(pair_cap)
            inner = Table(img_rows, colWidths=[img_w + 5, img_w + 5])
            inner.setStyle(TS([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            body = inner
            stats = f"{len(valid)} photo(s)"

    data = [
        [Paragraph("Photo Evidence", S["th"])],
        [body],
        [Paragraph(stats, S["center"])],
    ]
    t = Table(data, colWidths=[card_w])
    t.setStyle(TS([
        ("BACKGROUND", (0, 0), (0, 0), _NAVY),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (0, 0), 5),
        ("BOTTOMPADDING", (0, 0), (0, 0), 5),
        ("TOPPADDING", (0, 1), (0, 1), 4),
        ("BOTTOMPADDING", (0, 1), (0, 1), 4),
        ("TOPPADDING", (0, 2), (0, 2), 4),
        ("BOTTOMPADDING", (0, 2), (0, 2), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("BOX", (0, 0), (0, -1), 0.5, _LGRAY),
    ]))
    return t


def _build_history_page(current_inv: Invoice, history: List[Invoice], prop: Property,
                         currency: str, S, col_w: float,
                         img_data: Optional[Dict] = None,
                         evidence_items: Optional[list] = None) -> list:
    """Return a list of flowables for page 2: chart grid + analytics."""
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Paragraph, Spacer, Table, TableStyle as TS

    img_data = img_data or {}
    evidence_items = evidence_items or []

    # Collect metered utility keys across all invoices
    utility_keys: List[str] = []
    for inv in [current_inv] + list(history):
        for li in inv.line_items:
            if li.type == "metered_utility" and li.utility_key and li.utility_key not in utility_keys:
                utility_keys.append(li.utility_key)

    u_labels = {k: _util_label(k, prop) for k in utility_keys}

    # Build usage data per month (oldest → newest for chart axis)
    all_invoices = [current_inv] + list(history)
    usage_by_month: Dict[str, Dict[str, float]] = {}
    for inv in all_invoices:
        m = inv.billing_month
        if m not in usage_by_month:
            usage_by_month[m] = {}
        for li in inv.line_items:
            if li.type == "metered_utility" and li.utility_key:
                if li.current_reading is not None and li.previous_reading is not None:
                    usage_by_month[m][li.utility_key] = li.current_reading - li.previous_reading
                elif li.quantity:
                    usage_by_month[m][li.utility_key] = li.quantity
    # Always plot all 12 months of the billing year (Jan–Dec), filling gaps with 0
    try:
        billing_year = int(current_inv.billing_month[:4])
    except Exception:
        from datetime import date as _today
        billing_year = _today.today().year
    all_12_months = [f"{billing_year}-{mo:02d}" for mo in range(1, 13)]

    # Card grid — 2 columns
    gap = 4 * mm
    card_w = (col_w - gap) / 2
    card_h = 85 * mm

    cards = []
    for key in utility_keys:
        months_vals = [(m, usage_by_month.get(m, {}).get(key, 0)) for m in all_12_months]
        cards.append(_build_chart_card(u_labels[key], months_vals, _util_unit(key, prop),
                                       card_w, card_h, S))
    # Always add photo evidence card
    cards.append(_build_evidence_card(evidence_items, img_data, card_w, card_h, S))

    empty_cell = Table([[Paragraph("", S["small"])]], colWidths=[card_w])
    grid_rows = []
    for i in range(0, len(cards), 2):
        pair = cards[i:i + 2]
        if len(pair) == 1:
            pair.append(empty_cell)
        grid_rows.append(pair)

    grid = Table(grid_rows, colWidths=[card_w, card_w])
    grid.setStyle(TS([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), gap),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), gap),
    ]))

    flowables: list = [
        Paragraph(f"Usage & Evidence — {prop.name}", S["h2"]),
        Spacer(1, 3 * mm),
        grid,
    ]

    # Analytics table (only if we have actual usage data)
    an_rows = []
    for key in utility_keys:
        vals_with_month = [(m, usage_by_month[m][key]) for m in all_12_months if key in usage_by_month.get(m, {})]
        if not vals_with_month:
            continue
        nums = [v for _, v in vals_with_month]
        avg_v = sum(nums) / len(nums)
        peak_m, peak_v = max(vals_with_month, key=lambda x: x[1])
        total_v = sum(nums)
        unit_str = _util_unit(key, prop)
        u = f" {unit_str}" if unit_str else ""
        an_rows.append([
            u_labels[key],
            f"{avg_v:,.2f}{u}",
            _fmt_billing_month(peak_m),
            f"{peak_v:,.2f}{u}",
            f"{total_v:,.2f}{u}",
        ])

    if an_rows:
        an_head = [["Utility", "Avg / Month", "Peak Month", "Peak Value", "Total"]]
        an_tbl = Table(
            an_head + an_rows,
            colWidths=[col_w * 0.20] * 5,
            repeatRows=1,
        )
        an_tbl.setStyle(_tbl_style([("ALIGN", (1, 0), (-1, -1), "RIGHT")]))
        flowables += [
            HRFlowable(width="100%", thickness=0.4, color=_LGRAY),
            Spacer(1, 2 * mm),
            Paragraph("Usage Analytics", S["section"]),
            an_tbl,
        ]

    return flowables


# ── Payment receipt PDF ───────────────────────────────────────────────────────
async def build_payment_receipt_pdf(
    payment,
    applied_invoices: List[Tuple],   # list of (Invoice, amount_applied)
    property_obj: Property,
    tenant_name: str,
    unit_label: str,
    org_name: str = "",
    currency: str = "KES",
) -> bytes:
    """Build a single-page payment receipt PDF and return raw bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        BaseDocTemplate, Frame, HRFlowable, PageTemplate,
        Paragraph, Spacer, Table, TableStyle,
    )

    S = _styles()
    page_w, page_h = A4
    left_m = right_m = 20 * mm
    top_m = 65 * mm
    bottom_m = 22 * mm
    col_w = page_w - left_m - right_m

    prop = property_obj
    addr_parts = [prop.address.street, prop.address.city, prop.address.state, prop.address.country]
    address_str = ", ".join(p for p in addr_parts if p)
    receipt_no = f"RCT-{str(payment.id)[:8].upper()}"

    try:
        from datetime import date as _d
        pay_date = str(payment.payment_date)
    except Exception:
        pay_date = "—"

    def _on_page(c, d):
        w, h = d.pagesize
        band_h = 55 * mm
        c.saveState()
        c.setFillColor(_NAVY)
        c.rect(0, h - band_h, w, band_h, fill=1, stroke=0)
        c.setFillColor(_WHITE)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(20 * mm, h - 22 * mm, prop.name)
        c.setFont("Helvetica", 9)
        c.setFillColor(_rgb("#adc6f0"))
        c.drawString(20 * mm, h - 30 * mm, address_str)
        c.setFont("Helvetica-Bold", 36)
        c.setFillColor(_rgb("#1e3a8a"))
        c.drawRightString(w - 20 * mm, h - 25 * mm, "RECEIPT")
        c.setFont("Helvetica", 9)
        c.setFillColor(_rgb("#93c5fd"))
        c.drawRightString(w - 20 * mm, h - 36 * mm, receipt_no)
        c.restoreState()
        _draw_footer_line(c, d, org_name)

    story: list = []

    # ── Bill To / Receipt Details ─────────────────────────────────────────────
    bill_to = [
        Paragraph("BILL TO", ParagraphStyle("lbl", fontName="Helvetica-Bold", fontSize=7,
                                             textColor=_GRAY, leading=10, spaceAfter=4)),
        Paragraph(tenant_name or "—", S["h3"]),
        Paragraph(f"Unit: {unit_label}", S["body"]),
        Paragraph(prop.name, S["body"]),
    ]
    rcpt_details = [
        _detail_row("Receipt #",   receipt_no,                   S),
        _detail_row("Date",        pay_date,                     S),
        _detail_row("Method",      str(payment.method).replace("_", " ").title(), S),
        _detail_row("Amount Paid", _money(float(payment.amount), currency), S),
        _detail_row("Reference",   str(payment.notes or "—"),    S),
    ]
    hdr_tbl = Table(
        [[bill_to, rcpt_details]],
        colWidths=[col_w * 0.50, col_w * 0.50],
    )
    hdr_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(hdr_tbl)
    story.append(Spacer(1, 5 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_LGRAY))
    story.append(Spacer(1, 4 * mm))

    # ── Applied to invoices ───────────────────────────────────────────────────
    story.append(Paragraph("Payment Applied To", S["section"]))
    ap_head = [["Invoice #", "Billing Month", "Amount Applied", "Remaining Balance"]]
    ap_rows = []
    for inv, applied in applied_invoices:
        ap_rows.append([
            inv.reference_no,
            _fmt_billing_month(inv.billing_month),
            _money(applied, currency),
            _money(inv.balance_due, currency),
        ])
    ap_tbl = Table(
        ap_head + ap_rows,
        colWidths=[col_w * 0.28, col_w * 0.28, col_w * 0.22, col_w * 0.22],
    )
    ap_tbl.setStyle(_tbl_style([("ALIGN", (2, 0), (3, -1), "RIGHT")]))
    story.append(ap_tbl)
    story.append(Spacer(1, 5 * mm))

    # ── Total summary ─────────────────────────────────────────────────────────
    total_balance_after = sum(inv.balance_due for inv, _ in applied_invoices)
    summary_rows = [
        ["", Paragraph("Amount Received", S["right"]),
         Paragraph(_money(float(payment.amount), currency), S["bold_r"])],
        ["", Paragraph("Outstanding Balance", S["right"]),
         Paragraph(_money(total_balance_after, currency),
                   ParagraphStyle("bd2", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=_GREEN if total_balance_after == 0 else _RED,
                                  leading=13, alignment=2))],
    ]
    summary_tbl = Table(summary_rows, colWidths=[col_w * 0.54, col_w * 0.26, col_w * 0.20])
    summary_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEABOVE", (1, 0), (2, 0), 0.5, _NAVY),
        ("LINEBELOW", (1, -1), (2, -1), 0.5, _LGRAY),
    ]))
    story.append(summary_tbl)
    story.append(Spacer(1, 8 * mm))

    # ── Thank you message ─────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.4, color=_LGRAY))
    story.append(Spacer(1, 4 * mm))
    msg = (
        "Thank you for your payment. This receipt confirms that your payment has been "
        "received and recorded. Please retain this document for your records."
    )
    if total_balance_after > 0:
        msg += f" Your remaining balance is {_money(total_balance_after, currency)}."
    story.append(Paragraph(msg, S["body"]))

    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=A4,
        leftMargin=left_m, rightMargin=right_m,
        topMargin=top_m, bottomMargin=bottom_m,
    )
    frame = Frame(left_m, bottom_m, page_w - left_m - right_m,
                  page_h - top_m - bottom_m, id="main")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=_on_page)])
    doc.build(story)
    return buf.getvalue()


# ── Utility helpers ───────────────────────────────────────────────────────────
def _fmt_billing_month(m: str) -> str:
    """'2026-03' → 'March 2026'"""
    try:
        from datetime import date
        y, mo = int(m[:4]), int(m[5:7])
        return date(y, mo, 1).strftime("%B %Y")
    except Exception:
        return m


def _type_label(t: str) -> str:
    return {
        "rent": "Rent",
        "subscription_utility": "Utility",
        "metered_utility": "Metered",
        "credit": "Credit",
        "adjustment": "Adj.",
        "carried_forward": "BBF",
    }.get(t, t)


def _get_utility_tiers(utility_key: str, prop: Property) -> Optional[List[PricingTier]]:
    ud = prop.utility_defaults
    for attr in ("electricity", "water", "gas", "internet", "garbage", "security"):
        detail: Optional[UtilityDetail] = getattr(ud, attr, None)
        if detail and detail.tiers and attr == utility_key:
            return detail.tiers
    for custom in ud.custom:
        if custom.key == utility_key and custom.tiers:
            return custom.tiers
    return None


def _util_label(key: str, prop: Property) -> str:
    ud = prop.utility_defaults
    for attr in ("electricity", "water", "gas", "internet", "garbage", "security"):
        detail: Optional[UtilityDetail] = getattr(ud, attr, None)
        if detail and attr == key:
            return detail.label or key.title()
    for custom in ud.custom:
        if custom.key == key:
            return custom.label or key.title()
    return key.title()


def _util_unit(key: str, prop: Property) -> str:
    ud = prop.utility_defaults
    for attr in ("electricity", "water", "gas", "internet", "garbage", "security"):
        detail: Optional[UtilityDetail] = getattr(ud, attr, None)
        if detail and attr == key:
            return detail.unit or ""
    for custom in ud.custom:
        if custom.key == key:
            return custom.unit or ""
    return ""
