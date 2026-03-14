from datetime import datetime
from typing import Literal, Optional
import uuid

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class WhatsAppInstance(Document):
    """One WhatsApp account/session per org+property."""

    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script
    name: str                         # friendly label e.g. "Main Line"
    wuzapi_token: str                 # WuzAPI user token (== wuzapi username)
    wuzapi_user_id: Optional[str] = None  # WuzAPI internal user UUID (for deletion)
    webhook_token: str = Field(default_factory=lambda: uuid.uuid4().hex)
    status: Literal["disconnected", "connecting", "connected", "logged_out"] = "disconnected"
    phone_number: Optional[str] = None
    push_name: Optional[str] = None   # WA display name after connect
    qr_code: Optional[str] = None     # base64 QR image (cleared once connected)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "whatsapp_instances"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING)]),
            IndexModel([("wuzapi_token", ASCENDING)], unique=True),
            IndexModel([("webhook_token", ASCENDING)], unique=True),
        ]
