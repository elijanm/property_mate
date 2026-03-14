"""API keys for programmatic access."""
from typing import Optional
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class ApiKey(Document):
    name: str
    key_prefix: str            # first 8 chars shown in UI (e.g. "pms_ml_a")
    key_hash: str              # SHA-256 hash of full key
    owner_email: str
    rate_limit_per_min: int = 60
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    usage_count: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ml_api_keys"
