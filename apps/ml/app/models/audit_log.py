"""Immutable admin action audit trail."""
from typing import Optional, Dict, Any
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class AuditLog(Document):
    org_id: str = ""
    actor_email: str
    action: str              # e.g. "deploy_model", "ban_ip", "delete_api_key"
    resource_type: str       # model | api_key | ab_test | alert_rule | ip | user
    resource_id: Optional[str] = None
    details: Dict[str, Any] = {}
    ip_address: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ml_audit_logs"
