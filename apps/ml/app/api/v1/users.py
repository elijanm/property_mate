"""Admin user management endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import require_roles
from app.models.ml_user import MLUser
from app.utils.datetime import utc_now

router = APIRouter(prefix="/users", tags=["users"])

_admin = Depends(require_roles("admin"))


class CreateUserRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    role: str = "viewer"   # viewer | engineer | admin


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("")
async def list_users(
    role: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    skip: int = Query(0),
    admin=Depends(require_roles("admin")),
):
    # Admins only see users in their own org
    q = {"org_id": admin.org_id}
    if role:
        q["role"] = role
    total = await MLUser.find(q).count()
    users = await MLUser.find(q).sort("email").skip(skip).limit(limit).to_list()
    return {
        "total": total,
        "items": [_fmt(u) for u in users],
    }


@router.post("")
async def create_user(body: CreateUserRequest, admin=Depends(require_roles("admin"))):
    from app.services.auth_service import register
    if body.role not in ("viewer", "engineer", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role — must be viewer, engineer, or admin")
    # Admin-created users: inherit org_id, pre-verified (no email verification needed)
    user = await register(body.email, body.password, body.full_name, body.role, org_id=admin.org_id, skip_verification=True)
    return _fmt(user)


@router.get("/{user_id}", dependencies=[_admin])
async def get_user(user_id: str):
    user = await MLUser.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _fmt(user)


@router.patch("/{user_id}", dependencies=[_admin])
async def update_user(user_id: str, body: UpdateUserRequest):
    user = await MLUser.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        if body.role not in ("viewer", "engineer", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = body.role
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        user.is_active = body.is_active
    await user.save()
    return _fmt(user)


@router.delete("/{user_id}", status_code=204, dependencies=[_admin])
async def delete_user(user_id: str):
    user = await MLUser.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Soft-disable rather than hard delete
    user.is_active = False
    await user.save()


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
