from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class TrainerViolation(Document):
    class Settings:
        name = "trainer_violations"

    org_id: str
    owner_email: str
    submission_id: str
    trainer_name: str
    severity: str                        # low|high|critical|malicious
    summary: str
    issues: list = []
    admin_note: str = ""
    email_sent_at: Optional[datetime] = None
    resolved: bool = False
    created_at: datetime = Field(default_factory=utc_now)
