"""
ML Platform Clients API (admin-only).

Aggregates per-org stats from MLUser, MLUserPlan, ModelDeployment,
TrainerRegistration, and TrainerViolation.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.models.ml_user import MLUser
from app.models.model_deployment import ModelDeployment
from app.models.trainer_registration import TrainerRegistration
from app.models.trainer_violation import TrainerViolation
from app.utils.datetime import utc_now

router = APIRouter(tags=["clients"])

RequireAdmin = Depends(require_roles("admin"))


def _violation_dict(v: TrainerViolation) -> dict:
    return {
        "id": str(v.id),
        "org_id": v.org_id,
        "owner_email": v.owner_email,
        "submission_id": v.submission_id,
        "trainer_name": v.trainer_name,
        "severity": v.severity,
        "summary": v.summary,
        "issues": v.issues,
        "admin_note": v.admin_note,
        "resolved": v.resolved,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("/clients", dependencies=[RequireAdmin])
async def list_clients(
    _: MLUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List all orgs with aggregated stats."""
    # Gather all org_ids from users (exclude empty = system/unattached)
    all_users = await MLUser.find(MLUser.is_active == True).to_list()
    org_map: dict[str, dict] = {}

    for user in all_users:
        oid = user.org_id or ""
        if not oid:
            continue
        if oid not in org_map:
            org_map[oid] = {
                "org_id": oid,
                "user_count": 0,
                "trainer_count": 0,
                "deployment_count": 0,
                "violation_count": 0,
                "plan_name": None,
                "last_active": None,
            }
        org_map[oid]["user_count"] += 1
        if user.last_login_at:
            existing_last = org_map[oid]["last_active"]
            if not existing_last or user.last_login_at.isoformat() > existing_last:
                org_map[oid]["last_active"] = user.last_login_at.isoformat()

    if not org_map:
        return {"items": [], "total": 0}

    org_ids = list(org_map.keys())

    # Trainer counts
    all_trainers = await TrainerRegistration.find(
        {"org_id": {"$in": org_ids}}
    ).to_list()
    for t in all_trainers:
        if t.org_id in org_map:
            org_map[t.org_id]["trainer_count"] += 1

    # Deployment counts
    all_deployments = await ModelDeployment.find(
        {"org_id": {"$in": org_ids}}
    ).to_list()
    for d in all_deployments:
        oid = getattr(d, "org_id", "")
        if oid in org_map:
            org_map[oid]["deployment_count"] += 1

    # Violation counts
    all_violations = await TrainerViolation.find(
        {"org_id": {"$in": org_ids}}
    ).to_list()
    for v in all_violations:
        if v.org_id in org_map:
            org_map[v.org_id]["violation_count"] += 1

    # Plan names
    try:
        from app.models.ml_plan import MLUserPlan
        all_plans = await MLUserPlan.find(
            {"org_id": {"$in": org_ids}, "status": "active"}
        ).to_list()
        plan_by_org: dict[str, str] = {}
        for plan in all_plans:
            oid = getattr(plan, "org_id", "")
            if oid:
                plan_by_org[oid] = getattr(plan, "plan_name", "") or getattr(plan, "plan_id", "")
        for oid, name in plan_by_org.items():
            if oid in org_map:
                org_map[oid]["plan_name"] = name
    except Exception:
        pass

    items = list(org_map.values())
    total = len(items)
    skip = (page - 1) * page_size
    paginated = items[skip: skip + page_size]

    return {"items": paginated, "total": total}


@router.get("/clients/{org_id}", dependencies=[RequireAdmin])
async def get_client(
    org_id: str,
    _: MLUser = Depends(get_current_user),
):
    """Get detailed stats for a single org."""
    users = await MLUser.find(
        MLUser.org_id == org_id,
        MLUser.is_active == True,
    ).to_list()

    if not users:
        raise HTTPException(status_code=404, detail="Client org not found")

    trainer_count = await TrainerRegistration.find(
        TrainerRegistration.org_id == org_id
    ).count()

    deployment_count = await ModelDeployment.find(
        {"org_id": org_id}
    ).count()

    violations = await TrainerViolation.find(
        TrainerViolation.org_id == org_id
    ).to_list()

    last_active = None
    for u in users:
        if u.last_login_at:
            if not last_active or u.last_login_at.isoformat() > last_active:
                last_active = u.last_login_at.isoformat()

    plan_name = None
    try:
        from app.models.ml_plan import MLUserPlan
        plan = await MLUserPlan.find_one({"org_id": org_id, "status": "active"})
        if plan:
            plan_name = getattr(plan, "plan_name", "") or getattr(plan, "plan_id", "")
    except Exception:
        pass

    return {
        "org_id": org_id,
        "user_count": len(users),
        "trainer_count": trainer_count,
        "deployment_count": deployment_count,
        "violation_count": len(violations),
        "plan_name": plan_name,
        "last_active": last_active,
        "users": [
            {
                "email": u.email,
                "role": u.role,
                "is_verified": u.is_verified,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            }
            for u in users
        ],
    }


@router.get("/clients/{org_id}/violations", dependencies=[RequireAdmin])
async def get_client_violations(
    org_id: str,
    _: MLUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List trainer violations for a specific org."""
    skip = (page - 1) * page_size
    query = TrainerViolation.find(TrainerViolation.org_id == org_id)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).sort(-TrainerViolation.created_at).to_list()
    return {"items": [_violation_dict(v) for v in items], "total": total}


@router.get("/clients/violations/all", dependencies=[RequireAdmin])
async def get_all_violations(
    _: MLUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    resolved: Optional[bool] = Query(None),
):
    """List all trainer violations across all orgs."""
    skip = (page - 1) * page_size
    filters = []
    if resolved is not None:
        filters.append(TrainerViolation.resolved == resolved)
    query = TrainerViolation.find(*filters)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).sort(-TrainerViolation.created_at).to_list()
    return {"items": [_violation_dict(v) for v in items], "total": total}


class ViolationActionRequest(BaseModel):
    action: str   # "warn" | "suspend" | "whitelist"
    admin_note: str = ""


@router.post("/clients/{org_id}/violations/{violation_id}/action", dependencies=[RequireAdmin])
async def violation_action(
    org_id: str,
    violation_id: str,
    body: ViolationActionRequest,
    current_user: MLUser = Depends(get_current_user),
):
    """Take an action on a violation: warn, suspend, or whitelist."""
    violation = await TrainerViolation.get(violation_id)
    if not violation or violation.org_id != org_id:
        raise HTTPException(status_code=404, detail="Violation not found")

    valid_actions = ("warn", "suspend", "whitelist")
    if body.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {valid_actions}")

    now = utc_now()
    update: dict = {"updated_at": now}

    if body.admin_note:
        update["admin_note"] = body.admin_note

    if body.action == "whitelist":
        update["resolved"] = True

    await violation.set(update)

    # Optionally suspend all org users
    if body.action == "suspend":
        await MLUser.find(MLUser.org_id == org_id).update({"$set": {"is_active": False}})

    return {"ok": True, "action": body.action}
