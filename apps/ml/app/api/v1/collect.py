"""Public dataset collection endpoints — no auth, collector token only."""
from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, Form

import app.services.dataset_service as svc

router = APIRouter(prefix="/collect", tags=["collect"])


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
):
    """Submit one field entry. Accepts file upload (image/file) or text_value (text/number).
    Optionally accepts GPS coordinates (lat/lng/accuracy). Falls back to IP geolocation."""
    client_ip = svc._extract_client_ip(dict(request.headers), request.client.host if request.client else None)
    return await svc.submit_entry(
        token, field_id, file, text_value, description,
        lat=lat, lng=lng, accuracy=accuracy, client_ip=client_ip,
    )


@router.get("/{token}/entries")
async def get_my_entries(token: str):
    """Return all entries this collector has submitted."""
    return await svc.get_collector_entries(token)


@router.get("/{token}/points")
async def get_my_points(token: str):
    """Return collector's earned points and entry count."""
    return await svc.get_collector_points(token)
