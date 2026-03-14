from typing import Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class SSHAuditLog(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    ssh_request_id: str                 # SSHAccessRequest._id as string

    # Session
    session_start: datetime
    session_end: Optional[datetime] = None
    duration_seconds: Optional[int] = None

    # Network
    source_ip: str                      # Tailscale IP of requester
    destination_ip: str                 # Tailscale IP of target device/gateway
    destination_port: int = 22

    # Metrics
    bytes_rx: Optional[int] = None
    bytes_tx: Optional[int] = None
    commands_count: Optional[int] = None

    # Session recording (Phase 2 — optional)
    recording_s3_key: Optional[str] = None     # e.g. {org_id}/ssh-recordings/{id}.cast
    recording_format: str = "asciicast"

    # Outcome
    status: str = "active"             # active|completed|terminated
    termination_reason: Optional[str] = None   # normal|expired|revoked|error

    # User info (denormalised)
    user_id: str
    user_email: Optional[str] = None

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_ssh_audit"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("session_start", ASCENDING)]),
            IndexModel([("ssh_request_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("user_id", ASCENDING)]),
            IndexModel([("status", ASCENDING)]),
        ]
