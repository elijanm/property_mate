"""Alert rules management."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.services import alert_service
from app.models.alert_rule import AlertRule, NotificationChannel

router = APIRouter(prefix="/alert-rules", tags=["alert-rules"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class CreateRuleRequest(BaseModel):
    name: str
    metric: str
    trainer_name: Optional[str] = None
    operator: str = "gt"
    threshold: float
    window_minutes: int = 15
    cooldown_minutes: int = 60
    channels: List[NotificationChannel] = []


@router.post("", dependencies=[_engineer])
async def create_rule(
    body: CreateRuleRequest,
    user=Depends(get_current_user),
):
    rule = AlertRule(**body.model_dump(), created_by=user.email, org_id=user.org_id)
    await rule.insert()
    return _fmt(rule)


@router.get("")
async def list_rules(user=Depends(get_current_user)):
    rules = await AlertRule.find(AlertRule.org_id == user.org_id).to_list()
    return [_fmt(r) for r in rules]


@router.patch("/{rule_id}", dependencies=[_engineer])
async def update_rule(rule_id: str, body: dict, user=Depends(get_current_user)):
    rule = await AlertRule.get(rule_id)
    if not rule or rule.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Rule not found")
    for k, v in body.items():
        if hasattr(rule, k):
            setattr(rule, k, v)
    await rule.save()
    return _fmt(rule)


@router.delete("/{rule_id}", status_code=204, dependencies=[_engineer])
async def delete_rule(rule_id: str, user=Depends(get_current_user)):
    rule = await AlertRule.get(rule_id)
    if not rule or rule.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Rule not found")
    await rule.delete()


@router.get("/fires", dependencies=[_any_role])
async def list_fires(rule_id: Optional[str] = Query(None), limit: int = Query(100)):
    fires = await alert_service.list_fires(rule_id, limit)
    return [{"id": str(f.id), "rule_id": f.rule_id, "rule_name": f.rule_name, "trainer_name": f.trainer_name, "metric": f.metric, "value": f.value, "threshold": f.threshold, "message": f.message, "fired_at": f.fired_at} for f in fires]


def _fmt(r: AlertRule):
    return {"id": str(r.id), "name": r.name, "metric": r.metric, "trainer_name": r.trainer_name, "operator": r.operator, "threshold": r.threshold, "window_minutes": r.window_minutes, "cooldown_minutes": r.cooldown_minutes, "channels": [c.model_dump() for c in r.channels], "enabled": r.enabled, "created_by": r.created_by, "created_at": r.created_at}
