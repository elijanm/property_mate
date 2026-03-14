from datetime import datetime
from typing import Any, Dict, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class WhatsAppEvent(Document):
    """Raw event received from WuzAPI webhook for one WhatsApp instance."""

    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    instance_id: str                  # str(WhatsAppInstance.id)
    event_type: str                   # "Message", "QR", "Connected", "LoggedOut", etc.
    payload: Dict[str, Any]           # full raw webhook payload
    # Media stored in MinIO (populated when webhook contains a media message)
    media_key: Optional[str] = None         # S3 object key
    media_content_type: Optional[str] = None
    received_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "whatsapp_events"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("instance_id", ASCENDING), ("received_at", ASCENDING)]),
        ]
