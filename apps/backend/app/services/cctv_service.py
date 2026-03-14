"""CCTV service — camera CRUD and event management."""
from datetime import timedelta
from typing import List, Optional

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.models.cctv import CCTVCamera, CCTVEvent
from app.repositories.cctv_repository import cctv_camera_repository, cctv_event_repository
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
from app.utils.datetime import utc_now


def _camera_to_response(cam: CCTVCamera) -> CCTVCameraResponse:
    return CCTVCameraResponse(
        id=str(cam.id),
        org_id=cam.org_id,
        property_id=cam.property_id,
        name=cam.name,
        location=cam.location,
        description=cam.description,
        onvif_host=cam.onvif_host,
        onvif_port=cam.onvif_port,
        onvif_username=cam.onvif_username,
        rtsp_url=cam.rtsp_url,
        hls_url=cam.hls_url,
        snapshot_url=cam.snapshot_url,
        is_sandbox=cam.is_sandbox,
        sandbox_youtube_id=cam.sandbox_youtube_id,
        status=cam.status,
        last_seen_at=cam.last_seen_at,
        created_at=cam.created_at,
        updated_at=cam.updated_at,
    )


def _event_to_response(ev: CCTVEvent) -> CCTVEventResponse:
    return CCTVEventResponse(
        id=str(ev.id),
        org_id=ev.org_id,
        property_id=ev.property_id,
        camera_id=ev.camera_id,
        event_type=ev.event_type,
        is_suspicious=ev.is_suspicious,
        confidence=ev.confidence,
        occurred_at=ev.occurred_at,
        thumbnail_url=ev.thumbnail_url,
        clip_url=ev.clip_url,
        description=ev.description,
        tags=ev.tags,
        clip_offset_seconds=ev.clip_offset_seconds,
        is_reviewed=ev.is_reviewed,
        reviewed_by=ev.reviewed_by,
        reviewed_at=ev.reviewed_at,
        review_notes=ev.review_notes,
        created_at=ev.created_at,
    )


async def list_cameras(
    property_id: str,
    current_user: CurrentUser,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> CCTVCameraListResponse:
    cameras = await cctv_camera_repository.list_by_property(
        property_id, current_user.org_id, entity_type=entity_type, entity_id=entity_id
    )
    return CCTVCameraListResponse(
        items=[_camera_to_response(c) for c in cameras],
        total=len(cameras),
    )


async def get_camera(camera_id: str, current_user: CurrentUser) -> CCTVCameraResponse:
    cam = await cctv_camera_repository.get_by_id(camera_id, current_user.org_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _camera_to_response(cam)


async def create_camera(
    property_id: str,
    data: CCTVCameraCreateRequest,
    current_user: CurrentUser,
) -> CCTVCameraResponse:
    cam = CCTVCamera(
        org_id=current_user.org_id,
        property_id=property_id,
        name=data.name,
        location=data.location,
        description=data.description,
        onvif_host=data.onvif_host,
        onvif_port=data.onvif_port,
        onvif_username=data.onvif_username,
        onvif_password=data.onvif_password,
        rtsp_url=data.rtsp_url,
        hls_url=data.hls_url,
        snapshot_url=data.snapshot_url,
        is_sandbox=data.is_sandbox,
        sandbox_youtube_id=data.sandbox_youtube_id,
        created_by=current_user.user_id,
    )
    cam = await cctv_camera_repository.create(cam)
    return _camera_to_response(cam)


async def update_camera(
    camera_id: str,
    data: CCTVCameraUpdateRequest,
    current_user: CurrentUser,
) -> CCTVCameraResponse:
    cam = await cctv_camera_repository.get_by_id(camera_id, current_user.org_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    updates = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    cam = await cctv_camera_repository.update(cam, updates)
    return _camera_to_response(cam)


async def delete_camera(camera_id: str, current_user: CurrentUser) -> None:
    cam = await cctv_camera_repository.get_by_id(camera_id, current_user.org_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await cctv_camera_repository.delete(cam)


async def list_events(
    property_id: str,
    current_user: CurrentUser,
    camera_id: Optional[str] = None,
    is_suspicious: Optional[bool] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> CCTVEventListResponse:
    items, total = await cctv_event_repository.list_by_property(
        property_id=property_id,
        org_id=current_user.org_id,
        camera_id=camera_id,
        is_suspicious=is_suspicious,
        entity_type=entity_type,
        entity_id=entity_id,
        page=page,
        page_size=page_size,
    )
    return CCTVEventListResponse(
        items=[_event_to_response(e) for e in items],
        total=total,
    )


async def create_event(
    property_id: str,
    data: CCTVEventCreateRequest,
    current_user: CurrentUser,
) -> CCTVEventResponse:
    ev = CCTVEvent(
        org_id=current_user.org_id,
        property_id=property_id,
        camera_id=data.camera_id,
        event_type=data.event_type,
        is_suspicious=data.is_suspicious,
        confidence=data.confidence,
        occurred_at=data.occurred_at or utc_now(),
        thumbnail_url=data.thumbnail_url,
        clip_url=data.clip_url,
        description=data.description,
        tags=data.tags,
        clip_offset_seconds=data.clip_offset_seconds,
    )
    ev = await cctv_event_repository.create(ev)
    return _event_to_response(ev)


async def review_event(
    event_id: str,
    data: CCTVEventReviewRequest,
    current_user: CurrentUser,
) -> CCTVEventResponse:
    ev = await cctv_event_repository.get_by_id(event_id, current_user.org_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    ev = await cctv_event_repository.mark_reviewed(ev, current_user.user_id, data.review_notes)
    return _event_to_response(ev)


async def seed_sandbox_events(property_id: str, camera_id: str, current_user: CurrentUser) -> int:
    """Seed demo events for sandbox cameras."""
    import random
    now = utc_now()
    event_templates = [
        ("motion", False, 0.82, "Motion detected near entrance", ["motion"], 0.0),
        ("person", False, 0.94, "Person detected — tenant likely", ["person"], 12.5),
        ("suspicious", True, 0.78, "Unidentified person loitering for >5 min", ["suspicious", "loitering"], 45.0),
        ("vehicle", False, 0.91, "Vehicle entering parking area", ["vehicle"], 0.0),
        ("intrusion", True, 0.88, "After-hours entry detected at main gate", ["intrusion", "suspicious"], 8.0),
        ("person", False, 0.96, "Delivery personnel detected", ["person"], 0.0),
        ("suspicious", True, 0.72, "Unusual activity near utility room", ["suspicious"], 22.0),
        ("motion", False, 0.65, "Night motion — possible animal", ["motion"], 3.5),
        ("loitering", True, 0.83, "Group loitering near emergency exit", ["loitering", "suspicious"], 60.0),
        ("person", False, 0.99, "Tenant scan: John D. — access granted", ["person", "access"], 0.0),
    ]
    events = []
    for i, (etype, sus, conf, desc, tags, offset) in enumerate(event_templates):
        occurred = now - timedelta(hours=random.randint(1, 72), minutes=random.randint(0, 59))
        ev = CCTVEvent(
            org_id=current_user.org_id,
            property_id=property_id,
            camera_id=camera_id,
            event_type=etype,
            is_suspicious=sus,
            confidence=conf + random.uniform(-0.05, 0.05),
            occurred_at=occurred,
            description=desc,
            tags=tags,
            clip_offset_seconds=offset,
        )
        events.append(ev)
    await CCTVEvent.insert_many(events)
    return len(events)
