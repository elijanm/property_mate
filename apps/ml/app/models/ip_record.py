"""IP record — tracks requests and bans per IP address."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


class RequestSample(BaseModel):
    """Lightweight snapshot of a single request for pattern analysis."""
    timestamp: datetime
    method: str
    path: str
    status_code: int
    payload_size: int = 0
    user_agent: str = ""
    latency_ms: float = 0.0


class IPRecord(Document):
    """Tracks request history, threat score, and ban status per IP."""

    ip: str
    first_seen: datetime = Field(default_factory=utc_now)
    last_seen: datetime = Field(default_factory=utc_now)

    # Request counters
    total_requests: int = 0
    upload_attempts: int = 0
    blocked_uploads: int = 0
    error_count: int = 0          # 4xx/5xx responses

    # Threat scoring
    threat_score: float = 0.0     # 0.0 = safe, 1.0 = certain threat
    threat_reasons: List[str] = []
    ml_score: Optional[float] = None  # latest ML model score

    # Ban management
    is_banned: bool = False
    banned_at: Optional[datetime] = None
    ban_reason: str = ""
    ban_expires_at: Optional[datetime] = None  # None = permanent

    # Recent request samples (kept rolling, max 500)
    recent_requests: List[RequestSample] = []

    # Paths hit
    unique_paths: List[str] = []
    suspicious_path_hits: int = 0  # admin / config / env endpoints

    # Geo + reverse DNS (populated lazily)
    country: Optional[str] = None
    asn: Optional[str] = None
    hostname: Optional[str] = None

    # Audit
    manually_reviewed: bool = False
    notes: str = ""

    class Settings:
        name = "ip_records"
        indexes = [
            "ip",
            "is_banned",
            "threat_score",
            "last_seen",
        ]
