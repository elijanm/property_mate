from typing import Any, Dict, Optional

from app.models.audit_log import AuditLog
from beanie import Document, PydanticObjectId

class AuditLogRepository:
    async def create(
        self,
        org_id: str,
        user_id: str,
        resource_type: str,
        resource_id: Any,
        action: str,
        before: Optional[Dict[str, Any]] = None,
        after: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> AuditLog:
        log = AuditLog(
            org_id=org_id,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=str(resource_id),
            action=action,
            before=before,
            after=after,
            request_id=request_id,
        )
        await log.insert()
        return log


audit_log_repository = AuditLogRepository()
