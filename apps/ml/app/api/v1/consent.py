"""Consent template and record management API."""
from typing import Optional
from fastapi import APIRouter, Depends, Request, UploadFile, File
from pydantic import BaseModel

from app.dependencies.auth import RequireEngineer, RequireAdmin
from app.models.ml_user import MLUser
import app.services.consent_service as svc

router = APIRouter(prefix="/consent", tags=["consent"])


# ── Request schemas ────────────────────────────────────────────────────────────

class TemplateCreateRequest(BaseModel):
    name: str
    type: str = "individual"
    title: str = "Photography Consent Agreement"
    body: str
    requires_subject_signature: bool = True
    requires_collector_signature: bool = True
    allow_email_signing: bool = True
    active: bool = True


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    requires_subject_signature: Optional[bool] = None
    requires_collector_signature: Optional[bool] = None
    allow_email_signing: Optional[bool] = None
    active: Optional[bool] = None


class ConsentInitiateRequest(BaseModel):
    subject_name: str
    subject_email: Optional[str] = None
    representative_name: Optional[str] = None
    consent_type: str = "individual"


class ConsentSignRequest(BaseModel):
    role: str                   # "subject" | "collector"
    signature_data: str         # base64 PNG
    signer_name: str
    signer_email: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class EmailSignRequest(BaseModel):
    signature_data: str
    signer_name: str
    lat: Optional[float] = None
    lng: Optional[float] = None


# ── Admin template endpoints ───────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(user: MLUser = RequireEngineer):
    """List org templates + global templates."""
    return await svc.get_templates(user.org_id)


@router.post("/templates", status_code=201)
async def create_template(body: TemplateCreateRequest, user: MLUser = RequireEngineer):
    data = body.model_dump()
    t = await svc.create_template(user.org_id, data)
    return svc._template_to_dict(t, is_global=False)


@router.patch("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateUpdateRequest, user: MLUser = RequireEngineer):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    t = await svc.update_template(user.org_id, template_id, data)
    return svc._template_to_dict(t)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, user: MLUser = RequireEngineer):
    await svc.delete_template(user.org_id, template_id)


@router.get("/templates/global")
async def list_global_templates(user: MLUser = RequireEngineer):
    """List global (platform-level) consent templates."""
    return await svc.get_global_templates()


@router.patch("/templates/global/{template_id}")
async def update_global_template(
    template_id: str, body: TemplateUpdateRequest, user: MLUser = RequireAdmin
):
    """Update a global template — superadmin / admin only."""
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    t = await svc.update_global_template(template_id, data)
    return svc._template_to_dict(t, is_global=True)


# ── Org consent records ────────────────────────────────────────────────────────

@router.get("/records")
async def list_records(
    dataset_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    user: MLUser = RequireEngineer,
):
    """List consent records for the org, optionally filtered by dataset_id."""
    return await svc.list_consent_records(user.org_id, dataset_id=dataset_id, page=page, page_size=page_size)


@router.get("/records/{record_token}/pdf")
async def get_record_pdf(record_token: str, user: MLUser = RequireEngineer):
    """Get a presigned URL to download the signed consent PDF."""
    url = await svc.get_consent_pdf_url(record_token, user.org_id)
    return {"url": url}


@router.delete("/records/{record_token}", status_code=204)
async def void_record(record_token: str, user: MLUser = RequireEngineer):
    """Void a consent record."""
    await svc.void_consent_record(record_token, user.org_id)


# ── Public endpoints (no auth, collect token or record token) ─────────────────

@router.post("/initiate/{collect_token}", status_code=201)
async def initiate_consent(
    collect_token: str,
    body: ConsentInitiateRequest,
    request: Request,
):
    """Start a new consent session. Called by collector before capturing photos."""
    from app.services.dataset_service import _extract_client_ip
    client_ip = _extract_client_ip(
        dict(request.headers),
        request.client.host if request.client else None,
    )
    return await svc.initiate_consent(collect_token, body.model_dump(), client_ip or "")


@router.get("/sign/{record_token}")
async def get_for_signing(record_token: str):
    """Get a consent record by token (for displaying to signer)."""
    return await svc.get_consent_record(record_token)


@router.post("/sign/{record_token}")
async def sign_consent(record_token: str, body: ConsentSignRequest, request: Request):
    """Sign a consent record. role='subject' or 'collector'."""
    from app.services.dataset_service import _extract_client_ip
    client_ip = _extract_client_ip(
        dict(request.headers),
        request.client.host if request.client else None,
    )
    return await svc.sign_consent(
        record_token=record_token,
        role=body.role,
        signature_data=body.signature_data,
        signer_name=body.signer_name,
        signer_email=body.signer_email,
        client_ip=client_ip or "",
        lat=body.lat,
        lng=body.lng,
    )


@router.get("/email-sign/{email_token}")
async def get_for_email_signing(email_token: str):
    """Get a consent record by its email signing token."""
    return await svc.get_consent_record_by_email_token(email_token)


@router.post("/sign/{record_token}/offline-photo")
async def upload_offline_consent_photo(
    record_token: str,
    collector_name: str,
    file: UploadFile = File(...),
    request: Request = None,
):
    """Upload a photo of a physically-signed paper consent form.

    This marks the subject as having signed offline. The photo is stored in S3
    as proof of the physical signature.  The collector must then add their own
    digital signature via the normal /sign endpoint.
    """
    content = await file.read()
    mime = file.content_type or "image/jpeg"
    from app.services.dataset_service import _extract_client_ip
    client_ip = ""
    if request:
        client_ip = _extract_client_ip(
            dict(request.headers),
            request.client.host if request.client else None,
        ) or ""
    return await svc.sign_offline_photo(record_token, content, mime, collector_name, client_ip)


@router.post("/email-sign/{email_token}")
async def sign_by_email(email_token: str, body: EmailSignRequest, request: Request):
    """Subject signs via email link."""
    from app.services.dataset_service import _extract_client_ip
    client_ip = _extract_client_ip(
        dict(request.headers),
        request.client.host if request.client else None,
    )
    return await svc.sign_consent_by_email_token(
        email_token=email_token,
        signature_data=body.signature_data,
        signer_name=body.signer_name,
        client_ip=client_ip or "",
        lat=body.lat,
        lng=body.lng,
    )
