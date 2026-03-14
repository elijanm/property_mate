"""Per-request log entry stored to MongoDB."""
from datetime import datetime
from typing import Optional, Dict, Any
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class RequestLog(Document):
    """One document per HTTP request — captures full context for analysis."""

    timestamp: datetime = Field(default_factory=utc_now)
    ip: str
    method: str
    path: str
    query_string: str = ""
    status_code: int = 0
    latency_ms: float = 0.0

    # Headers (sensitive values redacted)
    headers: Dict[str, str] = {}

    # Payload
    payload_size: int = 0
    payload_preview: str = ""   # first 512 bytes of body, base64 if binary

    # Upload-specific
    is_upload: bool = False
    filename: Optional[str] = None
    file_size: Optional[int] = None
    file_mime: Optional[str] = None

    # Security flags set during request
    blocked: bool = False
    block_reason: str = ""
    threat_flags: list[str] = []

    user_agent: str = ""
    referer: str = ""

    class Settings:
        name = "request_logs"
        indexes = [
            "ip",
            "timestamp",
            "path",
            "is_upload",
            "blocked",
        ]
