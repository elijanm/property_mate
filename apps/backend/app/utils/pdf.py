"""
Professional lease PDF generation using ReportLab (pure-Python, no system deps).
Generates a full Kenya-standard tenancy agreement with e-signature verification annex.
"""
import hashlib
import io
from datetime import date, datetime
from typing import List, Optional

import structlog

logger = structlog.get_logger(__name__)

# ── Date helpers ──────────────────────────────────────────────────────────────

_MONTHS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
_TEENS = [
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
]
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]


def _year_to_words(y: int) -> str:
    """Convert 4-digit year (2000-2099) to English words."""
    if y == 2000:
        return "Two Thousand"
    if 2001 <= y <= 2009:
        return f"Two Thousand and {_ONES[y - 2000]}"
    if 2010 <= y <= 2019:
        return f"Two Thousand and {_TEENS[y - 2010]}"
    if 2020 <= y <= 2099:
        tens, ones = (y - 2000) // 10, (y - 2000) % 10
        return f"Two Thousand and {_TENS[tens]}" if ones == 0 else f"Two Thousand and {_TENS[tens]}-{_ONES[ones]}"
    return str(y)


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return f"{n}th"
    return f"{n}{['th', 'st', 'nd', 'rd', 'th'][min(n % 10, 4)]}"


def _id_label(id_type: Optional[str]) -> str:
    return {
        "national_id": "National ID",
        "passport": "Passport",
        "drivers_license": "Driver's Licence",
    }.get(id_type or "", id_type or "ID")


def _fmt_date(d) -> str:
    try:
        return d.strftime("%-d %B %Y") if d else "—"
    except Exception:
        return str(d) if d else "—"


def _fmt_ksh(a: Optional[float]) -> str:
    return f"KES {a:,.2f}" if a is not None else "—"


def _late_fee_str(late_fee_type: str, late_fee_value: float) -> str:
    if late_fee_type == "percentage":
        return f"{late_fee_value}% of monthly rent"
    return f"KES {late_fee_value:,.2f} (flat fee)"


# ── Main generator ────────────────────────────────────────────────────────────

def generate_lease_pdf(
    *,
    # Document identifiers (for metadata annex)
    onboarding_id: str,
    property_id: str,
    reference_no: str,
    # Org / company branding
    org_name: str,
    org_phone: Optional[str] = None,
    org_email: Optional[str] = None,
    org_address: Optional[str] = None,
    org_logo_bytes: Optional[bytes] = None,
    # Landlord/agent
    landlord_name: Optional[str] = None,
    landlord_address: Optional[str] = None,
    # Tenant personal details
    tenant_name: str,
    tenant_id_type: Optional[str] = None,
    tenant_id_number: Optional[str] = None,
    tenant_phone: Optional[str] = None,
    tenant_email: Optional[str] = None,
    tenant_emergency_contact_name: Optional[str] = None,
    tenant_emergency_contact_phone: Optional[str] = None,
    # Property / unit
    property_name: str,
    property_address: Optional[str] = None,
    unit_code: Optional[str] = None,
    # Lease financial terms
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    rent_amount: float = 0.0,
    deposit_amount: float = 0.0,
    utility_deposit: Optional[float] = None,
    # Billing settings
    invoice_day: int = 5,
    due_days: int = 7,
    grace_days: int = 3,
    late_fee_type: str = "flat",
    late_fee_value: float = 0.0,
    # Lease defaults
    notice_days: int = 30,
    termination_fee_type: str = "none",
    termination_fee_value: Optional[float] = None,
    deposit_refund_days: int = 30,
    # Utilities (list of objects with .label, .type, .rate, .unit_label, .deposit)
    utilities: Optional[List] = None,
    # Payment config (object with .paybill_number, .till_number, .bank_name,
    #                 .bank_account, .bank_branch, .account_reference)
    payment_config: Optional[object] = None,
    # Additional notes / special conditions
    notes: Optional[str] = None,
    # Tenant signature
    signed_at_str: Optional[str] = None,
    signature_bytes: Optional[bytes] = None,
    # Owner/agent countersignature
    owner_signature_bytes: Optional[bytes] = None,
    owner_signed_at_str: Optional[str] = None,
    owner_signed_by: Optional[str] = None,
    # Security metadata
    signer_ip: Optional[str] = None,
    verification_url: Optional[str] = None,
) -> bytes:
    """Build a professional PDF tenancy agreement and return the raw bytes."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm, mm
    from reportlab.platypus import (
        HRFlowable, Image, KeepTogether, PageBreak,
        Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    # ── Colours ───────────────────────────────────────────────────────────────
    DARK       = colors.HexColor("#111827")
    BLUE       = colors.HexColor("#1e3a8a")
    BLUE_LIGHT = colors.HexColor("#dbeafe")
    GREY       = colors.HexColor("#6b7280")
    GREY_LIGHT = colors.HexColor("#f3f4f6")
    GREY_MID   = colors.HexColor("#d1d5db")
    NAVY       = colors.HexColor("#0f172a")

    # ── Document setup ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    pw, _ = A4
    margin = 1.8 * cm
    usable = pw - 2 * margin

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=2.0 * cm, bottomMargin=2.0 * cm,
        title=f"Tenancy Agreement — {reference_no}",
        author=org_name, subject="Tenancy Agreement",
    )

    base = getSampleStyleSheet()

    def S(name, **kw):
        parent_name = kw.pop("parent", "Normal")
        return ParagraphStyle(name, parent=base[parent_name], **kw)

    s_org      = S("Org",      fontSize=13, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=DARK, spaceAfter=1)
    s_contact  = S("Contact",  fontSize=8,  alignment=TA_CENTER, textColor=GREY, spaceAfter=2)
    s_title    = S("Title",    fontSize=17, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=DARK, spaceAfter=2, spaceBefore=4)
    s_ref      = S("Ref",      fontSize=8,  alignment=TA_CENTER, textColor=GREY, spaceAfter=2)
    s_intro    = S("Intro",    fontSize=9,  textColor=DARK, leading=14, spaceAfter=4)
    s_section  = S("Section",  fontSize=8.5, fontName="Helvetica-Bold", textColor=BLUE, spaceBefore=10, spaceAfter=3)
    s_body     = S("Body",     fontSize=8.5, textColor=DARK, leading=13, spaceAfter=3)
    s_bodyj    = S("BodyJ",    fontSize=8.5, textColor=DARK, leading=13, spaceAfter=3, alignment=TA_JUSTIFY)
    s_clause   = S("Clause",   fontSize=8,  textColor=DARK, leading=12.5, spaceAfter=2, leftIndent=8)
    s_small    = S("Small",    fontSize=7.5, textColor=GREY, leading=11)
    s_label    = S("Label",    fontSize=8,  textColor=GREY)
    s_value    = S("Value",    fontSize=8.5, fontName="Helvetica-Bold", textColor=DARK)
    s_nb       = S("NB",       fontSize=7.5, textColor=GREY, leading=11, leftIndent=4)
    s_center   = S("Center",   fontSize=8,  alignment=TA_CENTER, textColor=GREY)
    s_annex_h  = S("AnnexH",  fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=colors.white)
    s_meta_hdr = S("MetaHdr", fontSize=8.5, fontName="Helvetica-Bold", textColor=DARK)

    def hr(color=GREY_MID, thick=0.5, top=2, bot=4):
        return HRFlowable(width="100%", thickness=thick, color=color, spaceBefore=top, spaceAfter=bot)

    # ── Pre-compute values ─────────────────────────────────────────────────────
    utils = utilities or []
    eff_date = start_date or date.today()
    day_ord  = _ordinal(eff_date.day)
    month_nm = _MONTHS[eff_date.month]
    yr_words = _year_to_words(eff_date.year)

    if start_date and end_date:
        duration_months = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
        dur_str = f"{duration_months} Month{'s' if duration_months != 1 else ''} renewable"
        end_str = f"and ending <b>{_fmt_date(end_date)}</b>"
    else:
        dur_str = "Month-to-Month"
        end_str = "continuing month-to-month until terminated in writing"

    fingerprint = f"{onboarding_id}|{reference_no}|{tenant_name}|{rent_amount}|{deposit_amount}|{start_date}|{end_date}"
    doc_hash    = hashlib.sha256(fingerprint.encode()).hexdigest()
    gen_ts      = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    ver_url     = verification_url or f"/verify/{onboarding_id}"

    lf_str = _late_fee_str(late_fee_type, late_fee_value)
    half   = (usable - 0.4 * cm) / 2

    pc = payment_config  # shorthand

    # ── Story begins ──────────────────────────────────────────────────────────
    story = []

    # ══════════════════════════════════════════════════════════════════════════
    # LETTERHEAD
    # ══════════════════════════════════════════════════════════════════════════
    if org_logo_bytes:
        try:
            lg = Image(io.BytesIO(org_logo_bytes), width=4 * cm, height=1.8 * cm, kind="proportional")
            lg.hAlign = "CENTER"
            story.append(lg)
            story.append(Spacer(1, 2 * mm))
        except Exception:
            pass

    story.append(Paragraph(org_name.upper(), s_org))

    contact_items = []
    if org_address:
        contact_items.append(org_address)
    if org_phone:
        contact_items.append(f"Tel: {org_phone}")
    if org_email:
        contact_items.append(f"Email: {org_email}")
    if contact_items:
        story.append(Paragraph(" | ".join(contact_items), s_contact))

    story.append(Spacer(1, 2 * mm))
    story.append(hr(BLUE, thick=2, top=0, bot=3))

    # ══════════════════════════════════════════════════════════════════════════
    # TITLE
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("TENANCY AGREEMENT", s_title))
    if reference_no:
        story.append(Paragraph(f"Reference: <b>{reference_no}</b>", s_ref))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph(
        f"An agreement is made this <b>{day_ord}</b> day of <b>{month_nm} {yr_words}</b> between:",
        s_intro,
    ))
    story.append(Spacer(1, 2 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # PARTIES
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("THE TENANT:", s_section))
    story.append(Paragraph(f"<b>{tenant_name}</b>", s_body))
    id_line = f"{_id_label(tenant_id_type)} No: {tenant_id_number or '—'}"
    story.append(Paragraph(id_line, s_body))
    if tenant_phone:
        story.append(Paragraph(f"Phone: {tenant_phone}", s_body))
    if tenant_email:
        story.append(Paragraph(f"Email: {tenant_email}", s_body))
    if tenant_emergency_contact_name:
        ec = tenant_emergency_contact_name
        if tenant_emergency_contact_phone:
            ec += f"  ({tenant_emergency_contact_phone})"
        story.append(Paragraph(f"Emergency Contact: {ec}", s_small))

    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph("THE LANDLORD/MANAGING AGENT:", s_section))
    story.append(Paragraph(f"<b>{landlord_name or org_name}</b>", s_body))
    if landlord_address:
        story.append(Paragraph(landlord_address, s_body))
    story.append(Paragraph(f"Managed by: <b>{org_name}</b>", s_body))

    story.append(Spacer(1, 3 * mm))
    story.append(hr())

    # ══════════════════════════════════════════════════════════════════════════
    # WHERE IT IS AGREED
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        f"<b>WHERE IT IS AGREED AS FOLLOWS:</b> The Managing agent agrees to let and the Tenant "
        f"agrees to lease <b>House No. {unit_code or '—'}</b> (unfurnished) and improvements erected "
        f"thereon and being situated at <b>{property_name.upper()} ESTATE</b>."
        + (f" {property_address}." if property_address else ""),
        s_bodyj,
    ))
    story.append(Spacer(1, 4 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # FINANCIAL TERMS TABLE
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("FINANCIAL TERMS &amp; PAYMENT SCHEDULE", s_section))

    TH = TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), GREY_LIGHT),
        ("LINEBELOW",    (0, 0), (-1, 0), 0.5,  GREY_MID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BLUE_LIGHT]),
        ("BOX",          (0, 0), (-1, -1), 0.5, GREY_MID),
        ("LINEAFTER",    (0, 0), (-1, -1), 0.3, GREY_MID),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
        ("LEFTPADDING",  (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ])

    col_w = [usable * 0.40, usable * 0.20, usable * 0.18, usable * 0.22]
    fin_rows = [[
        Paragraph("<b>Description</b>", s_label),
        Paragraph("<b>Amount (KES)</b>", s_label),
        Paragraph("<b>Frequency</b>", s_label),
        Paragraph("<b>Due Date</b>", s_label),
    ], [
        Paragraph("Monthly Rent", s_body),
        Paragraph(f"{rent_amount:,.2f}", s_body),
        Paragraph("Monthly", s_body),
        Paragraph(f"{_ordinal(invoice_day)} of each month", s_body),
    ], [
        Paragraph("Security Deposit (Refundable)", s_body),
        Paragraph(f"{deposit_amount:,.2f}", s_body),
        Paragraph("One-time", s_body),
        Paragraph("Upon signing", s_body),
    ]]

    for u in utils:
        rate_desc = f"{u.rate:,.2f}/{u.unit_label}" if getattr(u, "rate", None) and getattr(u, "unit_label", None) \
            else (f"KES {u.rate:,.2f}/mo" if getattr(u, "rate", None) else "As per usage")
        type_map = {"metered": "Metered", "shared": "Shared — Property Level", "subscription": "Subscription"}
        type_label = type_map.get(getattr(u, "type", ""), u.type.capitalize() if hasattr(u, "type") else "")
        amt_cell = "As per usage" if getattr(u, "type", "") == "metered" \
            else (f"{u.rate:,.2f}" if getattr(u, "rate", None) else "—")
        fin_rows.append([
            Paragraph(f"{u.label} ({type_label} — {rate_desc})", s_small),
            Paragraph(amt_cell, s_body),
            Paragraph("Monthly", s_body),
            Paragraph("With rent", s_body),
        ])

    fin_rows.append([
        Paragraph("Agreement Consideration Fee", s_body),
        Paragraph("0.00", s_body),
        Paragraph("One-time", s_body),
        Paragraph("Upon signing", s_body),
    ])

    fin_table = Table(fin_rows, colWidths=col_w)
    fin_table.setStyle(TH)
    story.append(fin_table)
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        "<b>NB:</b> Under no circumstances should the tenant use the deposit as rent.",
        s_nb,
    ))
    story.append(Spacer(1, 5 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # NUMBERED CLAUSES
    # ══════════════════════════════════════════════════════════════════════════
    def clause_block(heading: str, body_html: str):
        return KeepTogether([
            Paragraph(f"<b>{heading}:</b>", s_section),
            Paragraph(body_html, s_bodyj),
        ])

    # 1. Lease term
    story.append(clause_block(
        "1. LEASE TERM",
        f"The lease period shall be for <b>{dur_str}</b> commencing <b>{_fmt_date(start_date)}</b> {end_str}.",
    ))

    # 2. Rent payment
    pay_lines = [
        f"Monthly rent of <b>KES {rent_amount:,.2f}</b> is payable by the <b>{_ordinal(invoice_day)}</b> day of each month to:",
    ]
    if pc:
        if getattr(pc, "bank_name", None):
            pay_lines.append(f"<b>{pc.bank_name}</b>")
            if getattr(pc, "bank_branch", None):
                pay_lines.append(f"Branch: {pc.bank_branch}")
            if getattr(pc, "bank_account", None):
                pay_lines.append(f"Account No: {pc.bank_account}")
        if getattr(pc, "paybill_number", None):
            acct = getattr(pc, "account_reference", "") or ""
            pay_lines.append(
                f"M-Pesa Paybill: <b>{pc.paybill_number}</b>" + (f", Account: <b>{acct}</b>" if acct else "")
            )
        if getattr(pc, "till_number", None):
            pay_lines.append(f"M-Pesa Till: <b>{pc.till_number}</b>")
    pay_lines.append(
        f"Late payment after the {_ordinal(invoice_day)} attracts a penalty of <b>{lf_str}</b>. "
        "Bounced cheques incur re-collection fees of KES 3,500.00."
    )
    story.append(clause_block("2. RENT PAYMENT", "<br/>".join(pay_lines)))

    # 3. Utilities
    util_text = (
        "The tenant is responsible for all metered utilities as detailed in the table above. "
        "Utility deposits are refundable upon move-out."
    ) if utils else (
        "All utilities are the tenant's responsibility and shall be settled directly with the respective service providers."
    )
    story.append(clause_block("3. UTILITIES", util_text))

    # 4. Notice period
    story.append(clause_block(
        "4. NOTICE PERIOD",
        f"Either party can terminate the lease by giving <b>{notice_days} days</b> written notice "
        "or payment of equivalent rent in lieu.",
    ))

    # 5. Renewal
    story.append(clause_block(
        "5. RENEWAL",
        "Tenant must notify landlord 3 months before lease expiry if desirous of renewal. New terms will be negotiated.",
    ))

    # 6. Deposit refund
    story.append(clause_block(
        "6. DEPOSIT REFUND",
        f"Security deposit refundable within <b>{deposit_refund_days} days</b> after vacating, "
        "subject to deductions for damages or unpaid rent.",
    ))

    story.append(Spacer(1, 4 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # TENANT OBLIGATIONS
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("THE TENANT HEREBY AGREES:", s_section))
    t_obligs = [
        "To keep the premises and adjoining area clean and in good order at own expense and hand over the premises on termination in the same condition as on entry, fair wear and tear exempted.",
        "Not to do anything that may make insurance invalid or increase premium rates.",
        "To use the premise for residential purposes only and shall not carry on any trade or business without written consent.",
        "Not to assign, sublet, or part with possession of the premises without prior written consent of the Landlord.",
        "Not to damage or make alterations to the premises or drive nails, screws, bolts, or fasteners into walls, floors, or ceilings without written consent.",
        "To permit the managing agent at arranged times to enter the premises to inspect condition and fixtures.",
        "To permit agents during the last two months of tenancy to display \"To Let\" notices and show premises to prospective tenants.",
        "To report immediately in writing any structural defects, pest infestations, or signs of damage.",
        "Not to cause nuisance or annoyance to neighbors or damage the landlord's reputation.",
        "To be responsible for all damages during tenancy and replace lost or damaged items with similar quality.",
        "Not to use charcoal or wood for cooking in the house.",
        "One month before lease expiry, to professionally paint the premises with two coats of good paint to the landlord's satisfaction.",
        "To yield up the building with all fittings, fixtures, and equipment in good condition.",
        "Not to remove any fixtures, fittings, doors, grills, or bolts, even if installed at tenant's expense.",
        "To pay stamp duty on this Agreement and any preparation charges.",
        "To pay garbage fees, security fees, and other estate charges to required parties.",
        "To attend welfare meetings within the Estate and cooperate with neighbors.",
    ]
    abc = "abcdefghijklmnopqrstuvwxyz"
    for i, ob_text in enumerate(t_obligs):
        story.append(Paragraph(f"<b>{abc[i]})</b>&nbsp;&nbsp;{ob_text}", s_clause))

    story.append(Spacer(1, 4 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # LANDLORD OBLIGATIONS
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("THE LANDLORD AGREES:", s_section))
    l_obligs = [
        "That the tenant, paying rent and performing obligations, may quietly possess and enjoy the premises without unlawful interruption.",
        "To keep outside walls, roof, and main structure in good order.",
        "To pay rates and land rent for the premises.",
        "To grant tenant first option to renew for another term if tenant notifies landlord 3 months before expiry, subject to good standing.",
        "That if rent is in arrears for more than 10 days or tenant breaches any covenant, landlord may re-enter and repossess the premises without prejudice to other remedies.",
    ]
    for i, ob_text in enumerate(l_obligs):
        story.append(Paragraph(f"<b>{abc[i]})</b>&nbsp;&nbsp;{ob_text}", s_clause))

    story.append(Spacer(1, 4 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # ADDITIONAL CLAUSES
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("ADDITIONAL CLAUSES", s_section))
    add_clauses = [
        f"Rent Payment: Rent is due on the {_ordinal(invoice_day)} of each month (Mandatory)",
        f"Security Deposit: Refundable within {deposit_refund_days} days after move-out (Mandatory)",
        "Maintenance Responsibilities: Tenant is responsible for minor repairs under KES 5,000. Landlord handles major structural repairs.",
        "Utilities Payment: Tenant shall pay all utilities including water, electricity, and garbage collection as per usage.",
        "Subletting: Subletting is strictly prohibited without prior written consent from the landlord. (Mandatory)",
        "Property Use: Property is to be used for residential purposes only. No commercial activities allowed without written consent. (Mandatory)",
        f"Notice Period: Either party must provide {notice_days} days written notice before terminating the lease. (Mandatory)",
    ]
    if notes:
        add_clauses.append(f"Special Conditions: {notes}")
    for i, cl in enumerate(add_clauses, 1):
        story.append(Paragraph(f"<b>{i})</b>&nbsp;&nbsp;{cl}", s_clause))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        "<b>GOVERNING LAW:</b> This Agreement is governed by the Laws of Kenya. Disputes shall be resolved "
        "through mediation or arbitration, failing which the courts of Kenya shall have jurisdiction.",
        s_bodyj,
    ))

    # ══════════════════════════════════════════════════════════════════════════
    # SIGNATURES
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6 * mm))
    story.append(hr(BLUE, thick=1))
    story.append(Paragraph("SIGNATURES", s_section))
    story.append(Spacer(1, 3 * mm))

    def _sig_block(title, name, id_line, date_str, sig_bytes_data):
        items = []
        items.append(Paragraph(f"<b>{title}</b>", s_meta_hdr))
        items.append(Spacer(1, 1 * mm))
        items.append(Paragraph(f"NAME: <b>{name}</b>", s_body))
        if id_line:
            items.append(Paragraph(id_line, s_small))
        items.append(Spacer(1, 3 * mm))
        if sig_bytes_data:
            try:
                img = Image(io.BytesIO(sig_bytes_data), width=half * 0.72, height=1.7 * cm, kind="proportional")
                img.hAlign = "LEFT"
                items.append(img)
            except Exception:
                items.append(Paragraph("[ Signature on file ]", s_small))
        else:
            items.append(Spacer(1, 1.7 * cm))
        items.append(HRFlowable(width="90%", thickness=0.5, color=GREY_MID, spaceBefore=2, spaceAfter=1))
        items.append(Paragraph("SIGNATURE", s_small))
        items.append(Spacer(1, 2 * mm))
        items.append(Paragraph(f"DATE: {date_str or '______________________'}", s_body))
        return items

    tenant_sig_id = f"{_id_label(tenant_id_type)} No: {tenant_id_number}" if tenant_id_number else None
    tenant_block = _sig_block(
        "SIGNED BY THE TENANT:", tenant_name, tenant_sig_id, signed_at_str, signature_bytes,
    )
    owner_block = _sig_block(
        "SIGNED BY THE LANDLORD/AGENT:",
        owner_signed_by or landlord_name or org_name,
        None, owner_signed_at_str, owner_signature_bytes,
    )

    sig_table = Table([[tenant_block, owner_block]], colWidths=[half + 0.4 * cm, half])
    sig_table.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 12),
    ]))
    story.append(sig_table)
    story.append(Spacer(1, 5 * mm))

    # Page footer
    story.append(hr(GREY_MID, thick=0.3))
    footer_parts = [p for p in [org_phone and f"Phone: {org_phone}", org_email and f"Email: {org_email}"] if p]
    story.append(Paragraph(org_name, s_center))
    if org_address:
        story.append(Paragraph(org_address, s_center))
    if footer_parts:
        story.append(Paragraph(" | ".join(footer_parts), s_center))
    story.append(Paragraph(f"Generated on {_fmt_date(date.today())}", s_center))

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 2 — E-SIGNATURE VERIFICATION ANNEX
    # ══════════════════════════════════════════════════════════════════════════
    story.append(PageBreak())

    # Dark header band
    annex_hdr = Table(
        [[Paragraph("ANNEX: E-SIGNATURE VERIFICATION METADATA", s_annex_h)]],
        colWidths=[usable],
    )
    annex_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(annex_hdr)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "This annex provides cryptographic proof and audit trail for electronically signed agreements "
        "in compliance with Kenya's Evidence Act and Electronic Transactions regulations.",
        s_small,
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("DOCUMENT METADATA", s_meta_hdr))
    story.append(Spacer(1, 2 * mm))

    meta_rows = [
        [Paragraph("Parameter", s_label),              Paragraph("Value", s_label)],
        [Paragraph("Document ID", s_label),            Paragraph(onboarding_id, s_body)],
        [Paragraph("Agreement Reference", s_label),    Paragraph(reference_no, s_body)],
        [Paragraph("Property ID", s_label),            Paragraph(property_id, s_body)],
        [Paragraph("Property Name", s_label),          Paragraph(property_name, s_body)],
        [Paragraph("Tenant Name", s_label),            Paragraph(tenant_name, s_body)],
        [Paragraph("Tenant ID", s_label),              Paragraph(f"{_id_label(tenant_id_type)}: {tenant_id_number or '—'}", s_body)],
        [Paragraph("Emergency Contact", s_label),      Paragraph(
            f"{tenant_emergency_contact_name or '—'}"
            + (f" ({tenant_emergency_contact_phone})" if tenant_emergency_contact_phone else ""), s_body,
        )],
        [Paragraph("Generation Timestamp", s_label),   Paragraph(gen_ts, s_body)],
        [Paragraph("Tenant Signed At", s_label),       Paragraph(signed_at_str or "—", s_body)],
        [Paragraph("Owner Signed At", s_label),        Paragraph(owner_signed_at_str or "Pending", s_body)],
        [Paragraph("Signer IP Address", s_label),      Paragraph(signer_ip or "Not recorded", s_body)],
        [Paragraph("System Platform", s_label),        Paragraph(f"{org_name} Property Management System", s_body)],
        [Paragraph("Template Version", s_label),       Paragraph("2.0 (Kenya Standard)", s_body)],
        [Paragraph("Verification URL", s_label),       Paragraph(ver_url, s_body)],
        [Paragraph("Document SHA-256", s_label),       Paragraph(doc_hash, ParagraphStyle("Mono", parent=base["Normal"], fontSize=7, fontName="Courier", textColor=DARK))],
    ]

    meta_tbl = Table(meta_rows, colWidths=[usable * 0.33, usable * 0.67])
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), GREY_LIGHT),
        ("LINEBELOW",     (0, 0), (-1, 0), 0.5, GREY_MID),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, BLUE_LIGHT]),
        ("BOX",           (0, 0), (-1, -1), 0.5, GREY_MID),
        ("LINEAFTER",     (0, 0), (0, -1), 0.5, GREY_MID),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 5 * mm))

    # Signature record on annex page
    story.append(Paragraph("TENANT SIGNATURE RECORD", s_meta_hdr))
    story.append(Spacer(1, 2 * mm))
    if signature_bytes:
        try:
            sig2 = Image(io.BytesIO(signature_bytes), width=6 * cm, height=2 * cm, kind="proportional")
            sig2.hAlign = "LEFT"
            story.append(sig2)
        except Exception:
            story.append(Paragraph("[ Signature on file ]", s_small))
    else:
        story.append(Paragraph("[ Signature on file ]", s_small))
    story.append(Paragraph(
        f"Electronically signed by <b>{tenant_name}</b> on <b>{signed_at_str or '—'}</b>."
        + (f" Device IP: {signer_ip}" if signer_ip else ""),
        s_small,
    ))

    if owner_signature_bytes:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph("OWNER/AGENT SIGNATURE RECORD", s_meta_hdr))
        story.append(Spacer(1, 2 * mm))
        try:
            osig = Image(io.BytesIO(owner_signature_bytes), width=6 * cm, height=2 * cm, kind="proportional")
            osig.hAlign = "LEFT"
            story.append(osig)
        except Exception:
            story.append(Paragraph("[ Owner signature on file ]", s_small))
        story.append(Paragraph(
            f"Countersigned by <b>{owner_signed_by or org_name}</b> on <b>{owner_signed_at_str or '—'}</b>.",
            s_small,
        ))

    story.append(Spacer(1, 4 * mm))
    story.append(hr())

    # Legal notice box
    legal_tbl = Table(
        [[Paragraph(
            f"<b>Legal Notice:</b> This digitally signed document is legally binding under Kenya's Evidence Act "
            "and Electronic Transactions regulations. The cryptographic hash above can be independently verified "
            f"for authenticity. Any tampering with this document will invalidate the signature hashes. "
            f"To verify this document visit: <b>{ver_url}</b>",
            s_small,
        )]],
        colWidths=[usable],
    )
    legal_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), BLUE_LIGHT),
        ("BOX",           (0, 0), (-1, -1), 0.5, BLUE),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 9),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 9),
    ]))
    story.append(legal_tbl)
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(org_name, s_center))
    if org_address:
        story.append(Paragraph(org_address, s_center))
    if footer_parts:
        story.append(Paragraph(" | ".join(footer_parts), s_center))
    story.append(Paragraph(f"Generated on {_fmt_date(date.today())}", s_center))

    # ── Build ─────────────────────────────────────────────────────────────────
    doc.build(story)
    return buf.getvalue()
