from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.inspection import (
    DefectRequest,
    InspectionCreateRequest,
    InspectionPublicResponse,
    InspectionResponse,
    MeterReadingRequest,
)
from app.services import inspection_service

router = APIRouter(tags=["inspections"])


# ── Authenticated endpoints (owner / agent) ──────────────────────────────────

@router.post(
    "/leases/{lease_id}/inspections",
    response_model=InspectionResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_inspection(
    lease_id: str,
    request: InspectionCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InspectionResponse:
    result= await inspection_service.create_inspection(lease_id, request, current_user)
    if hasattr(result, "id"):
        result.id = str(result.id)
    return result

@router.get(
    "/leases/{lease_id}/inspections",
    response_model=List[InspectionResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_inspections(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[InspectionResponse]:
    result= await inspection_service.list_inspections(lease_id, current_user)
    if hasattr(result, "id"):
        result.id = str(result.id)
    return result


@router.post(
    "/inspections/{report_id}/review",
    response_model=InspectionResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def review_inspection(
    report_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InspectionResponse:
    result=  await inspection_service.review_inspection(report_id, current_user)
    if hasattr(result, "id"):
            result.id = str(result.id)
    return result


# ── Public token-based endpoints (no auth — token is the secret) ─────────────

@router.get(
    "/inspections/report/{token}",
    response_model=InspectionPublicResponse,
)
async def get_inspection_by_token(token: str) -> InspectionPublicResponse:
    result=   await inspection_service.get_by_token(token)
    if hasattr(result, "id"):
            result.id = str(result.id)
    return result


@router.post(
    "/inspections/report/{token}/meters",
    response_model=InspectionPublicResponse,
)
async def add_meter_reading(
    token: str,
    utility_key: str = Form(...),
    utility_label: str = Form(...),
    reading: float = Form(...),
    unit_label: str = Form(...),
    photo: Optional[UploadFile] = File(default=None),
) -> InspectionPublicResponse:
    photo_bytes: Optional[bytes] = None
    photo_ct = "image/jpeg"
    photo_fn = "photo.jpg"
    if photo:
        photo_bytes = await photo.read()
        photo_ct = photo.content_type or "image/jpeg"
        photo_fn = photo.filename or "photo.jpg"

    result=    await inspection_service.add_meter_reading(
        token=token,
        data=MeterReadingRequest(
            utility_key=utility_key,
            utility_label=utility_label,
            reading=reading,
            unit_label=unit_label,
        ),
        photo_bytes=photo_bytes,
        photo_content_type=photo_ct,
        photo_filename=photo_fn,
    )

    if hasattr(result, "id"):
            result.id = str(result.id)
    return result


@router.post(
    "/inspections/report/{token}/defects",
    response_model=InspectionPublicResponse,
)
async def add_defect(
    token: str,
    location: str = Form(...),
    description: str = Form(...),
    photos: List[UploadFile] = File(default=[]),
) -> InspectionPublicResponse:
    photo_bytes_list = []
    photo_content_types = []
    photo_filenames = []
    for f in photos:
        photo_bytes_list.append(await f.read())
        photo_content_types.append(f.content_type or "image/jpeg")
        photo_filenames.append(f.filename or "photo.jpg")

    result=     await inspection_service.add_defect(
        token=token,
        data=DefectRequest(location=location, description=description),
        photo_bytes_list=photo_bytes_list or None,
        photo_content_types=photo_content_types or None,
        photo_filenames=photo_filenames or None,
    )
    if hasattr(result, "id"):
            result.id = str(result.id)
    return result


@router.post(
    "/inspections/report/{token}/submit",
    response_model=InspectionPublicResponse,
)
async def submit_inspection(token: str) -> InspectionPublicResponse:
    result=  await inspection_service.submit_inspection(token)
    if hasattr(result, "id"):
            result.id = str(result.id)
    return result
