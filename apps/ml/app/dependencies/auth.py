"""Reusable FastAPI auth dependencies."""
from typing import Optional
from fastapi import Depends, Header, Query, HTTPException
from app.models.ml_user import MLUser


async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    token: Optional[str] = Query(None, include_in_schema=False),
) -> MLUser:
    """Resolve user from Bearer JWT, X-Api-Key header, or ?token= query param.

    The ?token= fallback exists for browser EventSource which cannot set custom headers.
    """
    # Prefer Authorization header; fall back to ?token= query param (SSE / EventSource)
    bearer_token: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split(" ", 1)[1]
    elif token:
        bearer_token = token

    if bearer_token:
        from app.services.auth_service import get_current_user as _jwt_user
        return await _jwt_user(bearer_token)

    if x_api_key:
        from app.services.api_key_service import validate_key
        key_record = await validate_key(x_api_key)
        if not key_record:
            raise HTTPException(status_code=401, detail="Invalid or expired API key")
        # Look up actual user so org_id is populated
        actual = await MLUser.find_one({"email": key_record.owner_email, "is_active": True})
        if actual:
            return actual
        # Fallback for edge-case where user record is gone
        return MLUser(email=key_record.owner_email, hashed_password="", role="engineer", is_active=True)

    raise HTTPException(status_code=401, detail="Not authenticated — provide Bearer token or X-Api-Key")


def require_roles(*roles: str):
    """Return a Depends() factory that checks user.role is in allowed roles."""
    async def _check(user: MLUser = Depends(get_current_user)) -> MLUser:
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{user.role}' is not allowed for this action. Required: {list(roles)}",
            )
        return user
    return _check


# Convenience shortcuts
CurrentUser = Depends(get_current_user)
RequireViewer    = Depends(require_roles("viewer", "engineer", "admin"))
RequireEngineer  = Depends(require_roles("engineer", "admin"))
RequireAdmin     = Depends(require_roles("admin"))
RequireAnnotator = Depends(require_roles("annotator", "engineer", "admin"))
