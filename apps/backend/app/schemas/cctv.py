from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class CCTVCameraCreateRequest(BaseModel):
    name: str
    location: Optional[str] = None
    description: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: int = 80
    onvif_username: Optional[str] = None
    onvif_password: Optional[str] = None
    rtsp_url: Optional[str] = None
    hls_url: Optional[str] = None
    snapshot_url: Optional[str] = None
    is_sandbox: bool = False
    sandbox_youtube_id: Optional[str] = None


class CCTVCameraUpdateRequest(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: Optional[int] = None
    onvif_username: Optional[str] = None
    onvif_password: Optional[str] = None
    rtsp_url: Optional[str] = None
    hls_url: Optional[str] = None
    snapshot_url: Optional[str] = None
    is_sandbox: Optional[bool] = None
    sandbox_youtube_id: Optional[str] = None
    status: Optional[str] = None


class CCTVCameraResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    name: str
    location: Optional[str] = None
    description: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: int
    onvif_username: Optional[str] = None
    rtsp_url: Optional[str] = None
    hls_url: Optional[str] = None
    snapshot_url: Optional[str] = None
    is_sandbox: bool
    sandbox_youtube_id: Optional[str] = None
    status: str
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class CCTVCameraListResponse(BaseModel):
    items: List[CCTVCameraResponse]
    total: int


class CCTVEventCreateRequest(BaseModel):
    camera_id: str
    event_type: str
    is_suspicious: bool = False
    confidence: float = 1.0
    occurred_at: Optional[datetime] = None
    thumbnail_url: Optional[str] = None
    clip_url: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = []
    clip_offset_seconds: float = 0.0


class CCTVEventReviewRequest(BaseModel):
    review_notes: Optional[str] = None


class CCTVEventResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    camera_id: str
    event_type: str
    is_suspicious: bool
    confidence: float
    occurred_at: datetime
    thumbnail_url: Optional[str] = None
    clip_url: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = []
    clip_offset_seconds: float
    is_reviewed: bool
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    created_at: datetime


class CCTVEventListResponse(BaseModel):
    items: List[CCTVEventResponse]
    total: int
