"""Audit trail logging."""
from typing import Any, Dict, Optional
from app.models.audit_log import AuditLog
from app.utils.datetime import utc_now


async def log_action(
    actor_email: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    entry = AuditLog(
        actor_email=actor_email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=ip_address,
    )
    await entry.insert()
    return entry


async def list_logs(
    actor_email: Optional[str] = None,
    resource_type: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 200,
    skip: int = 0,
) -> tuple[int, list[AuditLog]]:
    q = {}
    if actor_email:
        q["actor_email"] = actor_email
    if resource_type:
        q["resource_type"] = resource_type
    if action:
        q["action"] = action
    total = await AuditLog.find(q).count()
    items = await AuditLog.find(q).sort("-created_at").skip(skip).limit(limit).to_list()
    return total, items
