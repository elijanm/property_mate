"""API key management."""
import hashlib
import secrets
from typing import Optional
from datetime import datetime
import structlog
from fastapi import HTTPException

from app.models.api_key import ApiKey
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def create_key(name: str, owner_email: str, rate_limit: int = 60, expires_at: Optional[datetime] = None, org_id: Optional[str] = None) -> tuple[ApiKey, str]:
    raw_key = "sk_" + secrets.token_urlsafe(32)
    record = ApiKey(
        name=name,
        key_prefix=raw_key[:12],
        key_hash=_hash_key(raw_key),
        owner_email=owner_email,
        org_id=org_id,
        rate_limit_per_min=rate_limit,
        expires_at=expires_at,
    )
    await record.insert()
    logger.info("api_key_created", name=name, owner=owner_email)
    return record, raw_key


async def list_keys(owner_email: str) -> list[ApiKey]:
    return await ApiKey.find({"owner_email": owner_email, "is_active": True}).to_list()


async def revoke_key(key_id: str, owner_email: str) -> None:
    key = await ApiKey.get(key_id)
    if not key or key.owner_email != owner_email:
        raise HTTPException(status_code=404, detail="Key not found")
    key.is_active = False
    await key.save()
    logger.info("api_key_revoked", key_id=key_id)


async def validate_key(raw_key: str) -> Optional[ApiKey]:
    key_hash = _hash_key(raw_key)
    record = await ApiKey.find_one({"key_hash": key_hash, "is_active": True})
    if not record:
        return None
    if record.expires_at and record.expires_at < utc_now():
        return None
    record.last_used_at = utc_now()
    record.usage_count += 1
    await record.save()
    return record
