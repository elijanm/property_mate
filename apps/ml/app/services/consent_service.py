"""Consent template and signed consent record service."""
from __future__ import annotations
import base64
import io
import secrets
from typing import Optional, List
from datetime import datetime
from fastapi import HTTPException
import structlog

from app.models.consent import ConsentTemplate, ConsentRecord, ConsentSignature, GLOBAL_ORG_ID
from app.utils.datetime import utc_now
from app.utils.s3_url import generate_presigned_url
from app.core.config import settings

logger = structlog.get_logger(__name__)

# ── Global template bodies ────────────────────────────────────────────────────

_INDIVIDUAL_BODY = """PHOTOGRAPHY CONSENT AGREEMENT

I, {{subject_name}}, hereby grant {{org_name}} and its authorised representatives permission to photograph me for the purpose of dataset collection for machine learning research and development.

I understand that:
1. My image may be used in training datasets.
2. My personal information will be protected in accordance with applicable data protection laws.
3. I may withdraw this consent at any time by contacting the data collector.

Collector: {{collector_name}}
Dataset: {{dataset_name}}
Date: {{date}}"""

_GROUP_BODY = """GROUP PHOTOGRAPHY CONSENT AGREEMENT

I, {{representative_name}}, acting as the authorised representative of the group identified below, hereby grant {{org_name}} and its authorised representatives permission to photograph the group members for the purpose of dataset collection.

Group: {{subject_name}}
Representative: {{representative_name}}

I confirm that I have authority to provide consent on behalf of all individuals in the group and that all members are aware of and agree to this photography session.

Collector: {{collector_name}}
Dataset: {{dataset_name}}
Date: {{date}}"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _render_template(body: str, vars: dict) -> str:
    """Replace {{key}} placeholders in body with values from vars."""
    result = body
    for k, v in vars.items():
        result = result.replace(f"{{{{{k}}}}}", str(v) if v is not None else "")
    return result


def _template_to_dict(t: ConsentTemplate, is_global: bool = False) -> dict:
    d = t.model_dump()
    d["id"] = str(t.id)
    d["is_global"] = is_global
    return d


def _record_to_dict(r: ConsentRecord) -> dict:
    d = r.model_dump()
    d["id"] = str(r.id)
    return d


# ── Template management ───────────────────────────────────────────────────────

async def get_templates(org_id: str) -> list:
    """Return org templates + global ones (marked is_global)."""
    org_templates = await ConsentTemplate.find(
        ConsentTemplate.org_id == org_id,
        ConsentTemplate.active == True,
    ).to_list()
    global_templates = await ConsentTemplate.find(
        ConsentTemplate.org_id == GLOBAL_ORG_ID,
        ConsentTemplate.active == True,
    ).to_list()
    result = [_template_to_dict(t, is_global=False) for t in org_templates]
    result += [_template_to_dict(t, is_global=True) for t in global_templates]
    return result


async def get_template(org_id: str, template_id: str) -> ConsentTemplate:
    """Get one template; accessible if it belongs to the org or is global."""
    from beanie import PydanticObjectId
    try:
        oid = PydanticObjectId(template_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Template not found")
    t = await ConsentTemplate.find_one(ConsentTemplate.id == oid)
    if not t or (t.org_id != org_id and t.org_id != GLOBAL_ORG_ID):
        raise HTTPException(status_code=404, detail="Template not found")
    return t


async def create_template(org_id: str, data: dict) -> ConsentTemplate:
    t = ConsentTemplate(
        org_id=org_id,
        name=data["name"],
        type=data.get("type", "individual"),
        title=data.get("title", "Photography Consent Agreement"),
        body=data["body"],
        requires_subject_signature=data.get("requires_subject_signature", True),
        requires_collector_signature=data.get("requires_collector_signature", True),
        allow_email_signing=data.get("allow_email_signing", True),
        active=data.get("active", True),
    )
    await t.insert()
    logger.info("consent_template_created", template_id=str(t.id), org_id=org_id)
    return t


async def update_template(org_id: str, template_id: str, data: dict) -> ConsentTemplate:
    t = await get_template(org_id, template_id)
    if t.org_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot modify global template from org context")
    allowed = {"name", "type", "title", "body", "requires_subject_signature",
               "requires_collector_signature", "allow_email_signing", "active"}
    for k, v in data.items():
        if k in allowed:
            setattr(t, k, v)
    t.updated_at = utc_now()
    await t.save()
    return t


async def delete_template(org_id: str, template_id: str) -> None:
    t = await get_template(org_id, template_id)
    if t.org_id != org_id:
        raise HTTPException(status_code=403, detail="Cannot delete global templates")
    t.active = False
    t.updated_at = utc_now()
    await t.save()


async def get_global_templates() -> list:
    templates = await ConsentTemplate.find(
        ConsentTemplate.org_id == GLOBAL_ORG_ID,
        ConsentTemplate.active == True,
    ).to_list()
    return [_template_to_dict(t, is_global=True) for t in templates]


async def update_global_template(template_id: str, data: dict) -> ConsentTemplate:
    from beanie import PydanticObjectId
    try:
        oid = PydanticObjectId(template_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Template not found")
    t = await ConsentTemplate.find_one(
        ConsentTemplate.id == oid,
        ConsentTemplate.org_id == GLOBAL_ORG_ID,
    )
    if not t:
        raise HTTPException(status_code=404, detail="Global template not found")
    allowed = {"name", "type", "title", "body", "requires_subject_signature",
               "requires_collector_signature", "allow_email_signing", "active"}
    for k, v in data.items():
        if k in allowed:
            setattr(t, k, v)
    t.updated_at = utc_now()
    await t.save()
    return t


async def _get_effective_template(
    org_id: str,
    template_id: Optional[str],
    consent_type: str,
) -> ConsentTemplate:
    """
    Resolve the template to use:
    1. If template_id given, use it.
    2. Else find org template by type.
    3. Else find global template by type.
    4. Else raise 404.
    """
    if template_id:
        return await get_template(org_id, template_id)

    # Try org template
    org_t = await ConsentTemplate.find_one(
        ConsentTemplate.org_id == org_id,
        ConsentTemplate.type == consent_type,
        ConsentTemplate.active == True,
    )
    if org_t:
        return org_t

    # Fall back to global
    global_t = await ConsentTemplate.find_one(
        ConsentTemplate.org_id == GLOBAL_ORG_ID,
        ConsentTemplate.type == consent_type,
        ConsentTemplate.active == True,
    )
    if global_t:
        return global_t

    raise HTTPException(
        status_code=404,
        detail=f"No consent template found for type '{consent_type}'. Create one in Settings.",
    )


# ── Consent record flow ───────────────────────────────────────────────────────

async def initiate_consent(collect_token: str, data: dict, client_ip: str) -> dict:
    """Start a new consent session for a collector."""
    from app.services.dataset_service import get_collector_by_token
    from app.models.dataset import DatasetProfile
    from beanie import PydanticObjectId

    collector = await get_collector_by_token(collect_token)
    profile = await DatasetProfile.find_one(
        DatasetProfile.id == PydanticObjectId(collector.dataset_id)
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")

    consent_type = data.get("consent_type", "individual")
    template = await _get_effective_template(
        profile.org_id,
        profile.consent_template_id if hasattr(profile, "consent_template_id") else None,
        consent_type,
    )

    subject_name = data.get("subject_name", "").strip()
    if not subject_name:
        raise HTTPException(status_code=400, detail="subject_name is required")

    now = utc_now()
    rendered = _render_template(template.body, {
        "subject_name": subject_name,
        "collector_name": collector.name or collector.email,
        "dataset_name": profile.name,
        "date": now.strftime("%Y-%m-%d"),
        "org_name": profile.org_id,
        "representative_name": data.get("representative_name") or subject_name,
    })

    subject_email = data.get("subject_email") or None
    email_token = None
    if subject_email and template.allow_email_signing:
        email_token = secrets.token_urlsafe(32)

    record = ConsentRecord(
        org_id=profile.org_id,
        dataset_id=str(profile.id),
        collector_id=str(collector.id),
        template_id=str(template.id),
        consent_type=consent_type,
        subject_name=subject_name,
        subject_email=subject_email,
        representative_name=data.get("representative_name") or None,
        rendered_body=rendered,
        email_token=email_token,
        status="pending",
        ip_address=client_ip,
    )
    await record.insert()

    if subject_email and email_token:
        try:
            await send_consent_email(record, collector.name or collector.email)
            record.email_sent_at = utc_now()
            await record.save()
        except Exception as exc:
            logger.warning("consent_email_send_failed", error=str(exc), record_id=str(record.id))

    logger.info(
        "consent_initiated",
        record_id=str(record.id),
        dataset_id=str(profile.id),
        collector_id=str(collector.id),
        consent_type=consent_type,
    )
    return _record_to_dict(record)


async def get_consent_record(record_token: str) -> dict:
    """Get a consent record by its public token."""
    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record:
        raise HTTPException(status_code=404, detail="Consent record not found")
    return _record_to_dict(record)


async def sign_consent(
    record_token: str,
    role: str,
    signature_data: str,
    signer_name: str,
    signer_email: Optional[str],
    client_ip: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> dict:
    """Sign a consent record as subject or collector."""
    if role not in ("subject", "collector"):
        raise HTTPException(status_code=400, detail="role must be 'subject' or 'collector'")
    if not signature_data or not signature_data.strip():
        raise HTTPException(status_code=400, detail="signature_data is required")

    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record:
        raise HTTPException(status_code=404, detail="Consent record not found")
    if record.status == "void":
        raise HTTPException(status_code=409, detail="Consent record has been voided")
    if record.status == "complete":
        raise HTTPException(status_code=409, detail="Consent record is already complete")

    sig = ConsentSignature(
        signer_name=signer_name,
        signer_email=signer_email,
        signature_data=signature_data,
        ip_address=client_ip,
        lat=lat,
        lng=lng,
    )

    if role == "subject":
        record.subject_signature = sig
        if record.collector_signature:
            record.status = "complete"
        else:
            record.status = "subject_signed"
    else:  # collector
        record.collector_signature = sig
        if record.subject_signature:
            record.status = "complete"

    record.updated_at = utc_now()

    if record.status == "complete":
        try:
            pdf_key = await _generate_consent_pdf(record)
            record.pdf_key = pdf_key
        except Exception as exc:
            logger.error("consent_pdf_generation_failed", error=str(exc), record_id=str(record.id))

    await record.save()
    logger.info(
        "consent_signed",
        record_id=str(record.id),
        role=role,
        status=record.status,
    )
    return _record_to_dict(record)


async def sign_consent_by_email_token(
    email_token: str,
    signature_data: str,
    signer_name: str,
    client_ip: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> dict:
    """Find record by email_token and sign as subject."""
    record = await ConsentRecord.find_one(ConsentRecord.email_token == email_token)
    if not record:
        raise HTTPException(status_code=404, detail="Consent record not found or link expired")
    return await sign_consent(
        record_token=record.token,
        role="subject",
        signature_data=signature_data,
        signer_name=signer_name,
        signer_email=record.subject_email,
        client_ip=client_ip,
        lat=lat,
        lng=lng,
    )


async def get_consent_record_by_email_token(email_token: str) -> dict:
    """Get a consent record by its email signing token."""
    record = await ConsentRecord.find_one(ConsentRecord.email_token == email_token)
    if not record:
        raise HTTPException(status_code=404, detail="Consent record not found or link expired")
    return _record_to_dict(record)


async def link_entry_to_consent(record_token: str, entry_id: str) -> None:
    """Append entry_id to record.entry_ids."""
    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record:
        return
    if entry_id not in record.entry_ids:
        record.entry_ids.append(entry_id)
        record.updated_at = utc_now()
        await record.save()


async def list_consent_records(
    org_id: str,
    dataset_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """List consent records for an org."""
    query_parts = [ConsentRecord.org_id == org_id]
    if dataset_id:
        query_parts.append(ConsentRecord.dataset_id == dataset_id)
    total = await ConsentRecord.find(*query_parts).count()
    items = await ConsentRecord.find(*query_parts).skip((page - 1) * page_size).limit(page_size).to_list()
    return {
        "items": [_record_to_dict(r) for r in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


async def get_consent_pdf_url(record_token: str, org_id: str) -> str:
    """Validate org owns the record and return a presigned URL for the PDF."""
    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record or record.org_id != org_id:
        raise HTTPException(status_code=404, detail="Consent record not found")
    if not record.pdf_key:
        raise HTTPException(status_code=404, detail="PDF not yet generated for this consent record")
    return generate_presigned_url(record.pdf_key)


async def sign_offline_photo(
    record_token: str,
    photo_bytes: bytes,
    mime: str,
    collector_name: str,
    client_ip: str = "",
) -> dict:
    """Store a photo of a physically-signed paper consent form and mark subject as signed.

    The photo is uploaded to S3 as proof. The collector still needs to add their
    own digital signature via sign_consent(role='collector').
    """
    import uuid
    import aioboto3
    from app.core.config import settings

    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record:
        raise HTTPException(status_code=404, detail="Consent record not found")
    if record.status == "void":
        raise HTTPException(status_code=400, detail="Consent record has been voided")

    ext = mime.split("/")[-1].split(";")[0].strip() or "jpg"
    s3_key = f"{record.org_id}/consents/{record_token}/offline_photo_{uuid.uuid4()}.{ext}"

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        await s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=s3_key,
            Body=photo_bytes,
            ContentType=mime,
        )

    record.offline_photo_key = s3_key
    # Mark subject as signed offline — no digital signature_data, just proof photo
    record.subject_signature = ConsentSignature(
        signer_name=record.subject_name,
        signature_data="offline",  # sentinel value — means physical paper
        ip_address=client_ip,
    )
    record.status = "subject_signed"
    record.updated_at = utc_now()
    await record.save()

    d = _record_to_dict(record)
    if record.offline_photo_key:
        d["offline_photo_url"] = generate_presigned_url(record.offline_photo_key) or ""
    return d


async def void_consent_record(record_token: str, org_id: str) -> None:
    """Void a consent record."""
    record = await ConsentRecord.find_one(ConsentRecord.token == record_token)
    if not record or record.org_id != org_id:
        raise HTTPException(status_code=404, detail="Consent record not found")
    record.status = "void"
    record.updated_at = utc_now()
    await record.save()
    logger.info("consent_record_voided", record_id=str(record.id), org_id=org_id)


# ── PDF generation ────────────────────────────────────────────────────────────

async def _generate_consent_pdf(record: ConsentRecord) -> str:
    """Generate a PDF for a completed consent record and upload to S3."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
    )
    from reportlab.lib.enums import TA_LEFT, TA_CENTER

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title2", parent=styles["Heading1"],
        fontSize=16, textColor=colors.HexColor("#1e293b"),
        spaceAfter=12, alignment=TA_CENTER,
    )
    body_style = ParagraphStyle(
        "Body2", parent=styles["Normal"],
        fontSize=10, leading=14,
        textColor=colors.HexColor("#374151"),
    )
    label_style = ParagraphStyle(
        "Label", parent=styles["Normal"],
        fontSize=9, textColor=colors.HexColor("#6b7280"),
        fontName="Helvetica-Bold",
    )
    meta_style = ParagraphStyle(
        "Meta", parent=styles["Normal"],
        fontSize=8, textColor=colors.HexColor("#9ca3af"),
    )

    story = []

    # Title
    story.append(Paragraph("Photography Consent Agreement", title_style))
    story.append(Spacer(1, 0.3 * cm))

    # Status badge
    status_color = "#10b981" if record.status == "complete" else "#f59e0b"
    story.append(Paragraph(
        f'<font color="{status_color}"><b>Status: {record.status.upper()}</b></font>',
        ParagraphStyle("Badge", parent=body_style, alignment=TA_CENTER, fontSize=10),
    ))
    story.append(Spacer(1, 0.5 * cm))

    # Consent body
    for line in record.rendered_body.split("\n"):
        if line.strip():
            story.append(Paragraph(line.strip(), body_style))
            story.append(Spacer(1, 0.15 * cm))
        else:
            story.append(Spacer(1, 0.2 * cm))

    story.append(Spacer(1, 0.8 * cm))

    # Signatures
    def _sig_section(title: str, sig: Optional[ConsentSignature]) -> list:
        elems = []
        elems.append(Paragraph(title, label_style))
        elems.append(Spacer(1, 0.2 * cm))
        if sig:
            # Signature image
            try:
                sig_data = sig.signature_data
                if "," in sig_data:
                    sig_data = sig_data.split(",", 1)[1]
                img_bytes = base64.b64decode(sig_data)
                img_buf = io.BytesIO(img_bytes)
                rl_img = RLImage(img_buf, width=6 * cm, height=2.5 * cm)
                elems.append(rl_img)
            except Exception:
                elems.append(Paragraph("[Signature data unavailable]", body_style))
            elems.append(Spacer(1, 0.15 * cm))
            elems.append(Paragraph(f"Name: {sig.signer_name}", body_style))
            if sig.signer_email:
                elems.append(Paragraph(f"Email: {sig.signer_email}", body_style))
            elems.append(Paragraph(f"Date: {sig.signed_at.strftime('%Y-%m-%d %H:%M UTC')}", body_style))
            if sig.ip_address:
                elems.append(Paragraph(f"IP: {sig.ip_address}", meta_style))
            if sig.lat is not None and sig.lng is not None:
                elems.append(Paragraph(f"Location: {sig.lat:.5f}, {sig.lng:.5f}", meta_style))
        else:
            elems.append(Paragraph("Not yet signed", meta_style))
        elems.append(Spacer(1, 0.5 * cm))
        return elems

    story += _sig_section("Subject Signature", record.subject_signature)
    story += _sig_section("Collector Signature", record.collector_signature)

    # Footer metadata
    story.append(Paragraph("_" * 80, meta_style))
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(
        f"Record ID: {str(record.id)} | Dataset: {record.dataset_id} | "
        f"Type: {record.consent_type} | Generated: {utc_now().strftime('%Y-%m-%d %H:%M UTC')}",
        meta_style,
    ))

    doc.build(story)
    pdf_bytes = buf.getvalue()

    s3_key = f"{record.org_id}/consents/{record.dataset_id}/{str(record.id)}.pdf"
    import aioboto3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        await s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=s3_key,
            Body=pdf_bytes,
            ContentType="application/pdf",
        )

    logger.info("consent_pdf_generated", record_id=str(record.id), s3_key=s3_key)
    return s3_key


# ── Email ─────────────────────────────────────────────────────────────────────

async def send_consent_email(record: ConsentRecord, collector_name: str) -> None:
    """Send a consent signing link to the subject via email."""
    from app.core.email import send_email
    if not record.subject_email or not record.email_token:
        return
    sign_url = f"{settings.FRONTEND_BASE_URL}/consent-sign/{record.email_token}"
    html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">&#x1F4F7;</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">Photography Consent</span>
          </div>
        </td></tr>
        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#ffffff;">Consent Request</h2>
          <p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.6;">
            <strong style="color:#ffffff;">{collector_name}</strong> has requested your consent to photograph you
            for a data collection session. Please review and sign the agreement.
          </p>
          <p style="margin:0 0 16px;font-size:13px;color:#9ca3af;">Subject: <strong style="color:#ffffff;">{record.subject_name}</strong></p>
          <div style="text-align:center;margin:24px 0;">
            <a href="{sign_url}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 32px;border-radius:10px;">
              Review &amp; Sign Consent
            </a>
          </div>
          <p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">
            If you did not expect this request, you may safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#4b5563;">MLDock.io &middot; Photography Consent System</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
    await send_email(
        to=record.subject_email,
        subject=f"Photography Consent Request from {collector_name}",
        html=html,
    )


# ── Seed global templates ─────────────────────────────────────────────────────

async def seed_global_templates() -> None:
    """Create default INDIVIDUAL and GROUP global templates if they don't exist."""
    for consent_type, body in [("individual", _INDIVIDUAL_BODY), ("group", _GROUP_BODY)]:
        existing = await ConsentTemplate.find_one(
            ConsentTemplate.org_id == GLOBAL_ORG_ID,
            ConsentTemplate.type == consent_type,
        )
        if not existing:
            t = ConsentTemplate(
                org_id=GLOBAL_ORG_ID,
                name=f"Default {consent_type.capitalize()} Consent",
                type=consent_type,
                title="Photography Consent Agreement",
                body=body,
                requires_subject_signature=True,
                requires_collector_signature=True,
                allow_email_signing=True,
                active=True,
            )
            await t.insert()
            logger.info("consent_global_template_seeded", type=consent_type, template_id=str(t.id))
