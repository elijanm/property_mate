"""
Internal auth dependency — validates X-Internal-Secret header on EMQX hook endpoints.
EMQX is configured to send this header on every auth/ACL hook call.
These endpoints must NEVER be exposed to the public internet.
"""
from fastapi import Header, HTTPException, status
from app.core.config import settings


async def require_internal_secret(
    x_internal_secret: str = Header(alias="X-Internal-Secret"),
) -> None:
    if x_internal_secret != settings.iot_internal_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal secret",
        )
