"""
Auth dependency — validates the same JWT tokens issued by PMS backend.
IoT service uses the same jwt_secret, so no inter-service call is needed.
"""
from dataclasses import dataclass
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from app.core.config import settings

_bearer = HTTPBearer()


@dataclass
class CurrentUser:
    user_id: str
    org_id: str | None
    role: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> CurrentUser:
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    role = payload.get("role")

    if not user_id or not role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing claims")

    if role != "superadmin" and not org_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing org_id")

    return CurrentUser(user_id=user_id, org_id=org_id, role=role)


def require_roles(*roles: str):
    async def _check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' not permitted",
            )
        return current_user
    return _check
