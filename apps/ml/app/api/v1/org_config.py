"""Org configuration endpoints — slug, display name, org name, type."""
import re
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.dependencies.auth import RequireAdmin, RequireEngineer
from app.models.ml_user import MLUser
from app.models.org_config import OrgConfig
from app.utils.datetime import utc_now

router = APIRouter(prefix="/org", tags=["org"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$")


class OrgConfigResponse(BaseModel):
    org_id: str
    slug: str
    org_name: str
    display_name: str
    org_type: str
    previous_slugs: List[str] = Field(default_factory=list)


class OrgConfigUpdateRequest(BaseModel):
    slug: Optional[str] = None
    display_name: Optional[str] = None
    org_name: Optional[str] = None


async def _get_or_create(org_id: str, display_name: str = "") -> OrgConfig:
    cfg = await OrgConfig.find_one(OrgConfig.org_id == org_id)
    if not cfg:
        # Auto-generate a slug so trainer aliases are always prefixed correctly.
        # Same logic as auth_service registration — base from display_name, random suffix.
        base = re.sub(r"[^a-z0-9]", "", (display_name or "org").lower())[:12] or "org"
        short_id = str(uuid.uuid4()).replace("-", "")[:8]
        slug = f"{base}-{short_id}"
        cfg = OrgConfig(
            org_id=org_id,
            slug=slug,
            display_name=display_name,
            org_name=display_name,
        )
        await cfg.insert()
    elif not cfg.slug:
        # Back-fill slug for existing records that were created without one.
        base = re.sub(r"[^a-z0-9]", "", (cfg.display_name or cfg.org_name or "org").lower())[:12] or "org"
        short_id = str(uuid.uuid4()).replace("-", "")[:8]
        cfg.slug = f"{base}-{short_id}"
        cfg.updated_at = utc_now()
        await cfg.save()
    return cfg


def _to_response(cfg: OrgConfig) -> OrgConfigResponse:
    return OrgConfigResponse(
        org_id=cfg.org_id,
        slug=cfg.slug,
        org_name=cfg.org_name or cfg.display_name,
        display_name=cfg.display_name,
        org_type=cfg.org_type if hasattr(cfg, "org_type") else "individual",
        previous_slugs=cfg.previous_slugs or [],
    )


@router.get("/config")
async def get_org_config(user: MLUser = RequireEngineer) -> OrgConfigResponse:
    """Return the current org's configuration."""
    cfg = await _get_or_create(user.org_id)
    return _to_response(cfg)


@router.get("/config/check-slug")
async def check_slug(slug: str, user: MLUser = RequireEngineer) -> dict:
    """Check whether a slug is available. Returns {available, slug}."""
    slug = slug.lower().strip()
    if not slug or not _SLUG_RE.match(slug):
        return {"available": False, "slug": slug, "reason": "invalid"}
    existing = await OrgConfig.find_one(OrgConfig.slug == slug)
    # Available if no one owns it, or the current user already owns it
    available = not existing or existing.org_id == user.org_id
    return {"available": available, "slug": slug}


@router.get("/config/suggest-slug")
async def suggest_slug(user: MLUser = RequireEngineer) -> dict:
    """Return 3 unique available slug suggestions for the user's org."""
    cfg = await _get_or_create(user.org_id)
    base = re.sub(r"[^a-z0-9]", "", (cfg.org_name or cfg.display_name or "org").lower())[:12] or "org"
    suggestions = []
    attempts = 0
    while len(suggestions) < 3 and attempts < 20:
        short_id = str(uuid.uuid4()).replace("-", "")[:8]
        candidate = f"{base}-{short_id}"
        existing = await OrgConfig.find_one(OrgConfig.slug == candidate)
        if not existing or existing.org_id == user.org_id:
            suggestions.append(candidate)
        attempts += 1
    return {"suggestions": suggestions}


@router.patch("/config")
async def update_org_config(
    body: OrgConfigUpdateRequest,
    user: MLUser = RequireEngineer,  # engineers can update their own org
) -> OrgConfigResponse:
    """Update org slug, display name, org name. Engineers update their own org."""
    cfg = await _get_or_create(user.org_id)

    if body.slug is not None:
        slug = body.slug.lower().strip()
        if slug and not _SLUG_RE.match(slug):
            raise HTTPException(
                status_code=400,
                detail="Slug must be 3–40 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens.",
            )
        existing = await OrgConfig.find_one(OrgConfig.slug == slug)
        if existing and existing.org_id != user.org_id:
            raise HTTPException(status_code=409, detail="Slug already taken by another organisation.")
        # Keep old slug as a backward-compatible alias so existing integrations don't break
        old_slug = cfg.slug
        if old_slug and old_slug != slug:
            prev = list(cfg.previous_slugs or [])
            if old_slug not in prev:
                prev.append(old_slug)
            cfg.previous_slugs = prev
        cfg.slug = slug

    if body.org_name is not None:
        cfg.org_name = body.org_name.strip()
        if not cfg.display_name:
            cfg.display_name = cfg.org_name

    if body.display_name is not None:
        cfg.display_name = body.display_name.strip()

    cfg.updated_at = utc_now()
    await cfg.save()
    return _to_response(cfg)
