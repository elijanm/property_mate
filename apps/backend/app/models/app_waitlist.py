from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


class AppWaitlist(Document):
    """Tracks users who want to be notified when a coming-soon app becomes available."""

    org_id: str
    user_id: str
    app_id: str                     # e.g. "smart-lease-analyzer"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "app_waitlists"
        indexes = [
            # One entry per (org, user, app) — no duplicates
            IndexModel(
                [("org_id", ASCENDING), ("user_id", ASCENDING), ("app_id", ASCENDING)],
                unique=True,
            ),
            IndexModel([("app_id", ASCENDING)]),
        ]
