import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class AuditLog(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    user_id: str
    resource_type: str
    resource_id: str
    action: str  # create | update | delete | reserve | activate | release
    before: Optional[Dict[str, Any]] = None
    after: Optional[Dict[str, Any]] = None
    request_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "audit_logs"
        indexes = [
            IndexModel(
                [("org_id", ASCENDING), ("resource_type", ASCENDING), ("resource_id", ASCENDING)]
            ),
            IndexModel([("org_id", ASCENDING), ("created_at", ASCENDING)]),
        ]
