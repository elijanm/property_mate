from datetime import datetime
from typing import Any, Dict, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class JobRun(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: Optional[str] = None  # None for platform-level jobs
    job_type: str
    status: str = "queued"  # queued | in_progress | completed | failed | retrying
    payload: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    attempts: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "job_runs"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("job_type", ASCENDING)]),
        ]
