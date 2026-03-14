from datetime import datetime, timezone
from typing import Any, Optional
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


class InstalledApp(Document):
    """Tracks which apps are installed for an org and stores their configuration."""

    org_id: str
    app_id: str                     # e.g. "voice-agent"
    app_name: str                   # display name
    status: str = "active"          # active | inactive | configuring
    config: dict[str, Any] = Field(default_factory=dict)
    installed_by: str               # user_id
    installed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "installed_apps"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("app_id", ASCENDING)], unique=True),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
        ]
