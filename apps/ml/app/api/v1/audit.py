"""Audit log query endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends, Query

from app.dependencies.auth import require_roles
from app.services import audit_service

router = APIRouter(prefix="/audit", tags=["audit"])

_admin = Depends(require_roles("admin"))


@router.get("", dependencies=[_admin])
async def list_logs(
    actor_email: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    skip: int = Query(0),
):
    total, items = await audit_service.list_logs(actor_email, resource_type, action, limit, skip)
    return {
        "total": total,
        "items": [{"id": str(a.id), "actor_email": a.actor_email, "action": a.action, "resource_type": a.resource_type, "resource_id": a.resource_id, "details": a.details, "ip_address": a.ip_address, "created_at": a.created_at} for a in items],
    }
