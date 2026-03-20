from datetime import datetime, timezone
from typing import Any, Dict, Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class TrainerSubmission(Document):
    class Settings:
        name = "trainer_submissions"

    org_id: str
    owner_email: str
    trainer_name: str
    namespace: str
    file_key: str                        # S3 key OR local path to uploaded .py
    submission_hash: str                 # sha256(org_id + ":" + file_bytes)
    status: str = "scanning"            # scanning|pending_admin|approved|flagged|rejected
    llm_scan_result: Dict[str, Any] = {}
    llm_model_used: str = ""
    admin_ticket_id: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    parsed_metadata: Dict[str, Any] = {}
    submitted_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
