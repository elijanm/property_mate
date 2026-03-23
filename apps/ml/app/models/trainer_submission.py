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
    trainer_name: str                    # versioned name, e.g. "my_trainer_v2"
    base_trainer_name: str = ""          # base name without version suffix, e.g. "my_trainer"
    version_num: int = 1                 # 1 = original, 2 = _v2, etc.
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
    fast_path: bool = False             # True when hash matched previous approval — no LLM scan run
    submitted_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
