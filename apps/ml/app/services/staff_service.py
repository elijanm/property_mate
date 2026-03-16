"""Org staff management (plan-gated)."""
import secrets
import structlog
from typing import Optional

from app.models.ml_user import MLUser
from app.models.ml_plan import MLPlan, MLUserPlan
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_STAFF_ROLES = ("viewer", "engineer", "admin")


async def list_staff(org_id: str) -> list[MLUser]:
    """Return all active and inactive staff users for this org (excluding annotators)."""
    users = await MLUser.find(
        {"org_id": org_id, "role": {"$in": list(_STAFF_ROLES)}}
    ).sort("email").to_list()
    return users


async def get_staff_count(org_id: str) -> int:
    """Return count of active staff users in this org."""
    return await MLUser.find(
        {"org_id": org_id, "role": {"$in": list(_STAFF_ROLES)}, "is_active": True}
    ).count()


async def _get_plan_for_org(org_id: str) -> Optional[MLPlan]:
    """Look up the MLPlan for any admin in the org."""
    admin_user = await MLUser.find_one({"org_id": org_id, "role": "admin", "is_active": True})
    if not admin_user:
        return None
    user_plan = await MLUserPlan.find_one({"user_email": admin_user.email})
    if not user_plan:
        return None
    plan = await MLPlan.get(user_plan.plan_id)
    return plan


async def check_plan_allows_invite(org_id: str) -> tuple[bool, str]:
    """
    Returns (allowed, reason).
    max_staff_users=-1 means unlimited, 0 means disabled.
    Defaults to max_staff_users=3 if no plan is found.
    """
    plan = await _get_plan_for_org(org_id)
    max_staff = plan.max_staff_users if plan else 3

    if max_staff == 0:
        return False, "Staff invitations are disabled on your current plan."

    current = await get_staff_count(org_id)

    if max_staff == -1:
        return True, f"Unlimited staff — currently {current} members."

    if current >= max_staff:
        return False, f"Plan limit reached: {current}/{max_staff} staff members. Upgrade to invite more."

    return True, f"{current}/{max_staff} staff members used."


async def invite_staff(
    org_id: str,
    email: str,
    role: str,
    full_name: str,
    inviter_email: str,
) -> MLUser:
    """Create a new staff user and send invite email with temporary password."""
    if role not in _STAFF_ROLES:
        raise ValueError(f"Invalid role '{role}'. Must be one of: {', '.join(_STAFF_ROLES)}")

    allowed, reason = await check_plan_allows_invite(org_id)
    if not allowed:
        raise ValueError(reason)

    # Check for existing user with same email
    existing = await MLUser.find_one({"email": email})
    if existing:
        raise ValueError(f"A user with email '{email}' already exists.")

    # Generate temp password
    temp_password = secrets.token_urlsafe(12)

    # Create user via auth service
    from app.services.auth_service import register as _register
    user = await _register(
        email=email,
        password=temp_password,
        full_name=full_name,
        role=role,
        org_id=org_id,
        skip_verification=True,
    )

    # Send staff invite email
    try:
        from app.core.email import send_email, _staff_invite_html
        # Get org name from inviter
        inviter = await MLUser.find_one({"email": inviter_email})
        org_name = inviter.org_id if inviter else org_id
        login_url = f"{__import__('app.core.config', fromlist=['settings']).settings.FRONTEND_BASE_URL}/login"
        html = _staff_invite_html(
            inviter=inviter_email,
            org_name=org_name,
            email=email,
            temp_password=temp_password,
            login_url=login_url,
        )
        await send_email(email, "You've been invited to join the team on MLDock.io", html)
    except Exception as exc:
        logger.warning("staff_invite_email_failed", email=email, error=str(exc))

    logger.info("staff_invited", org_id=org_id, email=email, role=role, inviter=inviter_email)
    return user


async def remove_staff(org_id: str, email: str) -> None:
    """Deactivate a staff user (soft disable)."""
    user = await MLUser.find_one({"email": email, "org_id": org_id})
    if not user:
        raise ValueError(f"Staff member '{email}' not found in this org.")
    user.is_active = False
    await user.save()
    logger.info("staff_removed", org_id=org_id, email=email)


async def update_staff_role(org_id: str, email: str, new_role: str) -> MLUser:
    """Update a staff member's role."""
    if new_role not in _STAFF_ROLES:
        raise ValueError(f"Invalid role '{new_role}'. Must be one of: {', '.join(_STAFF_ROLES)}")
    user = await MLUser.find_one({"email": email, "org_id": org_id})
    if not user:
        raise ValueError(f"Staff member '{email}' not found in this org.")
    user.role = new_role
    await user.save()
    logger.info("staff_role_updated", org_id=org_id, email=email, new_role=new_role)
    return user
