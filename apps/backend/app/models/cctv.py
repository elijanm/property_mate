"""CCTV / IP camera models."""
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class CCTVCamera(Document):
    """An ONVIF-compatible IP camera configured for a property."""
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script

    # Identity
    name: str                                       # e.g. "Main Entrance"
    location: Optional[str] = None                  # e.g. "Gate A, Floor 1"
    description: Optional[str] = None

    # Stream configuration
    onvif_host: Optional[str] = None               # IP / hostname of camera
    onvif_port: int = 80
    onvif_username: Optional[str] = None
    onvif_password: Optional[str] = None           # stored encrypted in prod
    rtsp_url: Optional[str] = None                 # raw RTSP stream
    hls_url: Optional[str] = None                  # HLS endpoint (via media server proxy)
    snapshot_url: Optional[str] = None             # JPEG snapshot endpoint

    # Sandbox (demo) mode
    is_sandbox: bool = False
    sandbox_youtube_id: Optional[str] = None       # YouTube video ID for demo

    # Status
    status: str = "unknown"                        # online | offline | unknown
    last_seen_at: Optional[datetime] = None

    # Lifecycle
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "cctv_cameras"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("deleted_at", ASCENDING)]),
        ]


class CCTVEvent(Document):
    """A detected event on a camera feed (motion, person, suspicious activity, etc.)."""
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script
    camera_id: str

    # Event classification
    event_type: str                                # motion | person | vehicle | suspicious | intrusion | loitering | fire
    is_suspicious: bool = False                    # flagged for review
    confidence: float = 1.0                        # 0.0 – 1.0

    # Timestamps
    occurred_at: datetime = Field(default_factory=utc_now)

    # Media
    thumbnail_url: Optional[str] = None            # S3 key or URL to thumbnail
    clip_url: Optional[str] = None                 # S3 key or URL to video clip

    # Description
    description: Optional[str] = None
    tags: List[str] = []

    # For live-feed navigation: offset in seconds from the clip start
    clip_offset_seconds: float = 0.0

    # Review
    is_reviewed: bool = False
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None

    # Lifecycle
    created_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "cctv_events"
        indexes = [
            IndexModel([
                ("org_id", ASCENDING),
                ("property_id", ASCENDING),
                ("occurred_at", ASCENDING),
                ("deleted_at", ASCENDING),
            ]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("occurred_at", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("camera_id", ASCENDING), ("occurred_at", ASCENDING)]),
            IndexModel([("is_suspicious", ASCENDING), ("org_id", ASCENDING)]),
        ]
