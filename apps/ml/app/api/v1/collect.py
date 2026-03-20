"""Public dataset collection endpoints — no auth, collector token only."""
from typing import Optional, List
from fastapi import APIRouter, Request, UploadFile, File, Form
from pydantic import BaseModel

import app.services.dataset_service as svc

router = APIRouter(prefix="/collect", tags=["collect"])


class MultipartInitRequest(BaseModel):
    field_id: str
    filename: str
    content_type: str


class MultipartPart(BaseModel):
    part_number: int
    etag: str


class MultipartCompleteRequest(BaseModel):
    field_id: str
    key: str
    upload_id: str
    parts: List[MultipartPart]
    file_mime: str
    description: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None
    file_hash: Optional[str] = None
    consent_record_id: Optional[str] = None


@router.get("/{token}")
async def get_form(token: str):
    """Return dataset definition + collector context for the dynamic collection form."""
    return await svc.get_form_definition(token)


@router.post("/{token}/submit")
async def submit_entry(
    request: Request,
    token: str,
    field_id: str = Form(...),
    description: Optional[str] = Form(None),
    text_value: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    accuracy: Optional[float] = Form(None),
    consent_record_id: Optional[str] = Form(None),
):
    """Submit one field entry. Accepts file upload (image/file) or text_value (text/number).
    Optionally accepts GPS coordinates (lat/lng/accuracy). Falls back to IP geolocation."""
    client_ip = svc._extract_client_ip(dict(request.headers), request.client.host if request.client else None)
    return await svc.submit_entry(
        token, field_id, file, text_value, description,
        lat=lat, lng=lng, accuracy=accuracy, client_ip=client_ip,
        consent_record_id=consent_record_id,
    )


@router.get("/{token}/entries")
async def get_my_entries(token: str):
    """Return all entries this collector has submitted."""
    return await svc.get_collector_entries(token)


@router.get("/{token}/points")
async def get_my_points(token: str):
    """Return collector's earned points and entry count."""
    return await svc.get_collector_points(token)


@router.post("/{token}/multipart/initiate")
async def initiate_multipart(token: str, body: MultipartInitRequest):
    """Create a multipart upload. Returns upload_id + S3 key."""
    return await svc.initiate_multipart_upload(token, body.field_id, body.filename, body.content_type)


@router.get("/{token}/multipart/part-url")
async def get_part_url(token: str, key: str, upload_id: str, part_number: int):
    """Return a presigned PUT URL for one part. Browser uploads the chunk directly to S3."""
    await svc.get_collector_by_token(token)
    url = svc.get_part_presigned_url(key, upload_id, part_number)
    return {"url": url}


@router.post("/{token}/multipart/complete")
async def complete_multipart(request: Request, token: str, body: MultipartCompleteRequest):
    """Finalize multipart upload + create entry. Returns the new DatasetEntry."""
    client_ip = svc._extract_client_ip(dict(request.headers), request.client.host if request.client else None)
    return await svc.complete_multipart_upload(
        token=token,
        field_id=body.field_id,
        key=body.key,
        upload_id=body.upload_id,
        parts=[p.model_dump() for p in body.parts],
        file_mime=body.file_mime,
        description=body.description,
        lat=body.lat,
        lng=body.lng,
        accuracy=body.accuracy,
        client_ip=client_ip,
        file_hash=body.file_hash,
        consent_record_id=body.consent_record_id,
    )
