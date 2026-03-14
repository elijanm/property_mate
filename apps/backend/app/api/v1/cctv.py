"""CCTV Integration API."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.cctv import (
    CCTVCameraCreateRequest,
    CCTVCameraListResponse,
    CCTVCameraResponse,
    CCTVCameraUpdateRequest,
    CCTVEventCreateRequest,
    CCTVEventListResponse,
    CCTVEventResponse,
    CCTVEventReviewRequest,
)
from app.services import cctv_service

router = APIRouter(tags=["cctv"])


# ── Cameras ────────────────────────────────────────────────────────────────────

@router.get(
    "/properties/{property_id}/cctv/cameras",
    response_model=CCTVCameraListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_cameras(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVCameraListResponse:
    return await cctv_service.list_cameras(property_id, current_user)


@router.post(
    "/properties/{property_id}/cctv/cameras",
    response_model=CCTVCameraResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_camera(
    property_id: str,
    data: CCTVCameraCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVCameraResponse:
    return await cctv_service.create_camera(property_id, data, current_user)


@router.get(
    "/cctv/cameras/{camera_id}",
    response_model=CCTVCameraResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_camera(
    camera_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVCameraResponse:
    return await cctv_service.get_camera(camera_id, current_user)


@router.patch(
    "/cctv/cameras/{camera_id}",
    response_model=CCTVCameraResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_camera(
    camera_id: str,
    data: CCTVCameraUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVCameraResponse:
    return await cctv_service.update_camera(camera_id, data, current_user)


@router.delete(
    "/cctv/cameras/{camera_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_camera(
    camera_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await cctv_service.delete_camera(camera_id, current_user)


# ── Events ─────────────────────────────────────────────────────────────────────

@router.get(
    "/properties/{property_id}/cctv/events",
    response_model=CCTVEventListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_events(
    property_id: str,
    camera_id: Optional[str] = Query(default=None),
    is_suspicious: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVEventListResponse:
    return await cctv_service.list_events(
        property_id, current_user,
        camera_id=camera_id,
        is_suspicious=is_suspicious,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/properties/{property_id}/cctv/events",
    response_model=CCTVEventResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_event(
    property_id: str,
    data: CCTVEventCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVEventResponse:
    return await cctv_service.create_event(property_id, data, current_user)


@router.patch(
    "/cctv/events/{event_id}/review",
    response_model=CCTVEventResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def review_event(
    event_id: str,
    data: CCTVEventReviewRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> CCTVEventResponse:
    return await cctv_service.review_event(event_id, data, current_user)


@router.post(
    "/properties/{property_id}/cctv/cameras/{camera_id}/seed-events",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def seed_events(
    property_id: str,
    camera_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    count = await cctv_service.seed_sandbox_events(property_id, camera_id, current_user)
    return {"seeded": count}
