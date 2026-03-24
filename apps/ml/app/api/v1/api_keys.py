"""API key management endpoints."""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user
from app.services import api_key_service

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


class CreateKeyRequest(BaseModel):
    name: str
    rate_limit_per_min: int = 60
    expires_at: Optional[datetime] = None


_NON_ADMIN_DEFAULT_RATE = 10  # requests/minute — non-admins cannot override this


@router.post("")
async def create_key(
    body: CreateKeyRequest,
    user=Depends(get_current_user),
):
    # Non-admin users always get the default rate limit regardless of what they send
    rate_limit = body.rate_limit_per_min if user.role == "admin" else _NON_ADMIN_DEFAULT_RATE
    record, raw_key = await api_key_service.create_key(body.name, user.email, rate_limit, body.expires_at, org_id=user.org_id or None)
    return {"id": str(record.id), "key": raw_key, "prefix": record.key_prefix, "name": record.name, "note": "Store this key — it will not be shown again"}


@router.get("")
async def list_keys(user=Depends(get_current_user)):
    keys = await api_key_service.list_keys(user.email)
    return [{"id": str(k.id), "name": k.name, "prefix": k.key_prefix, "rate_limit_per_min": k.rate_limit_per_min, "expires_at": k.expires_at, "last_used_at": k.last_used_at, "usage_count": k.usage_count, "created_at": k.created_at} for k in keys]


@router.delete("/{key_id}", status_code=204)
async def revoke_key(key_id: str, user=Depends(get_current_user)):
    await api_key_service.revoke_key(key_id, user.email)
