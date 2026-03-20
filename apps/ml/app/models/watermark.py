"""Watermark configuration models."""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class OrgWatermarkConfig(Document):
    """One document per org — controls org-level watermark settings."""
    org_id: str

    # Watermark image
    watermark_key: Optional[str] = None     # S3 key of the PNG watermark
    watermark_name: str = ""                # display name (original filename)

    # Placement
    position: str = "bottom_right"         # top_left|top_right|bottom_left|bottom_right|center
    opacity: float = 0.5                   # 0.0–1.0
    scale: float = 0.2                     # fraction of base image width (0.05–0.5)

    # Policy
    active: bool = True                    # watermarking enabled for this org (text fallback when no image)
    allow_user_override: bool = False      # engineers/admins may upload their own watermark
    allowed_plans: List[str] = Field(default_factory=list)  # plan names that auto-get override

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "org_watermark_configs"
        indexes = [[("org_id", 1)]]


class UserWatermarkConfig(Document):
    """Per-user watermark override — only effective when org allow_user_override=True
    or admin has explicitly granted this user watermark permission."""
    user_id: str
    org_id: str

    # Watermark image
    watermark_key: Optional[str] = None
    watermark_name: str = ""

    # Same placement options as org config; falls back to org defaults
    position: Optional[str] = None
    opacity: Optional[float] = None
    scale: Optional[float] = None

    active: bool = True
    granted_by: Optional[str] = None       # email of admin who granted permission
    granted_at: Optional[datetime] = None

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "user_watermark_configs"
        indexes = [
            [("user_id", 1)],
            [("org_id", 1), ("user_id", 1)],
        ]
