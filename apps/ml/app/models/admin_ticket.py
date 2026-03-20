from datetime import datetime, timezone
from typing import Any, Dict, Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class AdminTicket(Document):
    class Settings:
        name = "admin_tickets"

    category: str = "trainer_security"
    title: str
    body: str
    related_id: str = ""                 # submission_id or other ref
    org_id: str = ""
    owner_email: str = ""
    severity: str = "medium"            # low|medium|high|critical
    status: str = "open"                # open|reviewing|resolved|dismissed
    assigned_to: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
