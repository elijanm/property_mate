"""
Telemetry alert rule CRUD endpoints.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.alert_rule import AlertRule
from app.core.exceptions import ResourceNotFoundError
from app.utils.datetime import utc_now

router = APIRouter(prefix="/alert-rules", tags=["alert-rules"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class AlertRuleCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    property_id: Optional[str] = None
    device_id: Optional[str] = None
    device_type_id: Optional[str] = None
    group_id: Optional[str] = None
    is_active: bool = True
    telemetry_key: str
    operator: str                          # gt | lt | gte | lte | eq | neq
    threshold: float
    consecutive_violations: int = 1
    cooldown_m: int = 15
    severity: str = "warning"
    alert_message_template: str = "Device {device_name}: {key} is {value} ({operator} {threshold})"
    create_ticket: bool = True
    notify_email: bool = True


class AlertRuleUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    property_id: Optional[str] = None
    device_id: Optional[str] = None
    device_type_id: Optional[str] = None
    group_id: Optional[str] = None
    is_active: Optional[bool] = None
    telemetry_key: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    consecutive_violations: Optional[int] = None
    cooldown_m: Optional[int] = None
    severity: Optional[str] = None
    alert_message_template: Optional[str] = None
    create_ticket: Optional[bool] = None
    notify_email: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    id: str
    org_id: str
    property_id: Optional[str]
    device_id: Optional[str]
    device_type_id: Optional[str]
    group_id: Optional[str]
    name: str
    description: Optional[str]
    is_active: bool
    telemetry_key: str
    operator: str
    threshold: float
    consecutive_violations: int
    cooldown_m: int
    severity: str
    alert_message_template: str
    create_ticket: bool
    notify_email: bool
    created_by: str
    created_at: str
    updated_at: str


def _to_response(rule: AlertRule) -> AlertRuleResponse:
    return AlertRuleResponse(
        id=str(rule.id),
        org_id=rule.org_id,
        property_id=rule.property_id,
        device_id=rule.device_id,
        device_type_id=rule.device_type_id,
        group_id=rule.group_id,
        name=rule.name,
        description=rule.description,
        is_active=rule.is_active,
        telemetry_key=rule.telemetry_key,
        operator=rule.operator,
        threshold=rule.threshold,
        consecutive_violations=rule.consecutive_violations,
        cooldown_m=rule.cooldown_m,
        severity=rule.severity,
        alert_message_template=rule.alert_message_template,
        create_ticket=rule.create_ticket,
        notify_email=rule.notify_email,
        created_by=rule.created_by,
        created_at=rule.created_at.isoformat(),
        updated_at=rule.updated_at.isoformat(),
    )


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("", response_model=AlertRuleResponse, status_code=201,
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def create_alert_rule(
    body: AlertRuleCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    rule = AlertRule(
        org_id=current_user.org_id,
        property_id=body.property_id,
        device_id=body.device_id,
        device_type_id=body.device_type_id,
        group_id=body.group_id,
        name=body.name,
        description=body.description,
        is_active=body.is_active,
        telemetry_key=body.telemetry_key,
        operator=body.operator,
        threshold=body.threshold,
        consecutive_violations=body.consecutive_violations,
        cooldown_m=body.cooldown_m,
        severity=body.severity,
        alert_message_template=body.alert_message_template,
        create_ticket=body.create_ticket,
        notify_email=body.notify_email,
        created_by=current_user.user_id,
    )
    await rule.insert()
    return _to_response(rule)


@router.get("", response_model=Dict[str, Any])
async def list_alert_rules(
    current_user: CurrentUser = Depends(require_roles("owner", "agent", "superadmin")),
    device_id: Optional[str] = Query(None),
    device_type_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.role != "superadmin":
        filt["org_id"] = current_user.org_id
    if device_id:
        filt["device_id"] = device_id
    if device_type_id:
        filt["device_type_id"] = device_type_id
    if is_active is not None:
        filt["is_active"] = is_active

    total = await AlertRule.find(filt).count()
    rules = await AlertRule.find(filt).skip((page - 1) * page_size).limit(page_size).to_list()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_response(r).model_dump() for r in rules],
    }


@router.get("/{rule_id}", response_model=AlertRuleResponse,
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def get_alert_rule(
    rule_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    rule = await AlertRule.find_one({"_id": PydanticObjectId(rule_id), "deleted_at": None})
    if not rule or (current_user.role != "superadmin" and rule.org_id != current_user.org_id):
        raise ResourceNotFoundError("AlertRule", rule_id)
    return _to_response(rule)


@router.patch("/{rule_id}", response_model=AlertRuleResponse,
              dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def update_alert_rule(
    rule_id: str,
    body: AlertRuleUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    rule = await AlertRule.find_one({"_id": PydanticObjectId(rule_id), "deleted_at": None})
    if not rule or (current_user.role != "superadmin" and rule.org_id != current_user.org_id):
        raise ResourceNotFoundError("AlertRule", rule_id)

    updates: Dict[str, Any] = {"updated_at": utc_now()}
    for field in (
        "name", "description", "property_id", "device_id", "device_type_id", "group_id",
        "is_active", "telemetry_key", "operator", "threshold", "consecutive_violations",
        "cooldown_m", "severity", "alert_message_template", "create_ticket", "notify_email",
    ):
        val = getattr(body, field)
        if val is not None:
            updates[field] = val

    await rule.set(updates)
    return _to_response(await AlertRule.get(rule.id))


@router.delete("/{rule_id}", status_code=204,
               dependencies=[Depends(require_roles("owner", "superadmin"))])
async def delete_alert_rule(
    rule_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    rule = await AlertRule.find_one({"_id": PydanticObjectId(rule_id), "deleted_at": None})
    if not rule or (current_user.role != "superadmin" and rule.org_id != current_user.org_id):
        raise ResourceNotFoundError("AlertRule", rule_id)
    await rule.set({"deleted_at": utc_now(), "is_active": False})
