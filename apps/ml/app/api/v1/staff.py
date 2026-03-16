"""Staff management endpoints — org-scoped, plan-gated."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import require_roles, get_current_user
from app.models.ml_user import MLUser
import app.services.staff_service as staff_svc

router = APIRouter(prefix="/staff", tags=["staff"])

_any_staff = Depends(require_roles("viewer", "engineer", "admin"))
_admin_only = Depends(require_roles("admin"))


class InviteStaffRequest(BaseModel):
    email: str
    role: str = "viewer"   # viewer | engineer
    full_name: str = ""


class UpdateRoleRequest(BaseModel):
    role: str


def _fmt(u: MLUser) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": u.created_at,
        "last_login_at": u.last_login_at,
    }


@router.get("")
async def list_staff(user: MLUser = _any_staff):
    """List org staff along with plan limits info."""
    members = await staff_svc.list_staff(user.org_id)
    can_invite, reason = await staff_svc.check_plan_allows_invite(user.org_id)
    current_count = await staff_svc.get_staff_count(user.org_id)

    from app.services.staff_service import _get_plan_for_org
    plan = await _get_plan_for_org(user.org_id)
    max_allowed = plan.max_staff_users if plan else 3

    return {
        "items": [_fmt(m) for m in members],
        "plan": {
            "current_count": current_count,
            "max_allowed": max_allowed,
            "can_invite": can_invite,
            "reason": reason,
        },
    }


@router.post("/invite")
async def invite_staff(body: InviteStaffRequest, user: MLUser = _admin_only):
    """Invite a new staff member. Admin only; plan-gated."""
    if body.role not in ("viewer", "engineer", "admin"):
        raise HTTPException(status_code=400, detail="Role must be viewer, engineer, or admin")
    try:
        new_user = await staff_svc.invite_staff(
            org_id=user.org_id,
            email=body.email,
            role=body.role,
            full_name=body.full_name,
            inviter_email=user.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _fmt(new_user)


@router.patch("/{email}/role")
async def update_staff_role(email: str, body: UpdateRoleRequest, user: MLUser = _admin_only):
    """Update a staff member's role. Admin only."""
    try:
        updated = await staff_svc.update_staff_role(user.org_id, email, body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _fmt(updated)


@router.delete("/{email}", status_code=204)
async def remove_staff(email: str, user: MLUser = _admin_only):
    """Deactivate a staff member. Admin only."""
    try:
        await staff_svc.remove_staff(user.org_id, email)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
