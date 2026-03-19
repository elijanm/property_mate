"""Superadmin — platform-wide user management."""
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import CurrentUser, require_roles
from app.models.user import User
from app.utils.datetime import utc_now

router = APIRouter(prefix="/admin", tags=["admin"])

RequireSuperAdmin = Depends(require_roles("superadmin"))


# ── schemas ────────────────────────────────────────────────────────────────────

class AdminUserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    org_id: Optional[str]
    is_active: bool
    created_at: str

    @classmethod
    def from_doc(cls, u: User) -> "AdminUserResponse":
        return cls(
            id=str(u.id),
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            role=u.role,
            org_id=u.org_id,
            is_active=u.is_active,
            created_at=u.created_at.isoformat(),
        )


class AdminUserListResponse(BaseModel):
    items: List[AdminUserResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class SuspendRequest(BaseModel):
    is_active: bool


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/users", response_model=AdminUserListResponse)
async def list_all_users(
    q: Optional[str] = Query(None, description="Search by email or name"),
    role: Optional[str] = Query(None, description="Filter by role"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: CurrentUser = RequireSuperAdmin,
):
    flt: dict = {"deleted_at": None}

    if role:
        flt["role"] = role
    if is_active is not None:
        flt["is_active"] = is_active
    if q:
        flt["$or"] = [
            {"email": {"$regex": q, "$options": "i"}},
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
        ]

    total = await User.find(flt).count()
    users = (
        await User.find(flt)
        .sort("-created_at")
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    return AdminUserListResponse(
        items=[AdminUserResponse.from_doc(u) for u in users],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, -(-total // page_size)),
    )


@router.patch("/users/{user_id}/suspend", response_model=AdminUserResponse)
async def set_user_active(
    user_id: str,
    body: SuspendRequest,
    current_user: CurrentUser = RequireSuperAdmin,
):
    from beanie import PydanticObjectId as OID

    try:
        oid = OID(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    user = await User.find_one({"_id": oid, "deleted_at": None})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if str(user.id) == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot suspend your own account")

    user.is_active = body.is_active
    user.updated_at = utc_now()
    await user.save()

    return AdminUserResponse.from_doc(user)
