"""Watermark management API.

Admin endpoints:
  GET    /watermark/org           – get org config
  POST   /watermark/org/upload    – upload org watermark image
  PATCH  /watermark/org           – update settings (position/opacity/scale/active/allow_user_override)
  DELETE /watermark/org/image     – remove org watermark image

  GET    /watermark/org/users               – list all user overrides
  POST   /watermark/org/users/{uid}/grant   – grant user override
  DELETE /watermark/org/users/{uid}/revoke  – revoke user override

User (engineer/admin) endpoints:
  GET    /watermark/me            – get own watermark config
  POST   /watermark/me/upload     – upload personal watermark image
  PATCH  /watermark/me            – update personal settings
  DELETE /watermark/me/image      – remove personal watermark image

Display endpoint (serves original + watermark composited on-the-fly):
  GET    /watermark/display?key={s3_key}&user_id={email}  – internal; called by entry proxy
"""
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import RequireAdmin, RequireEngineer
from app.models.ml_user import MLUser
import app.services.watermark_service as svc

router = APIRouter(prefix="/watermark", tags=["watermark"])


# ── Request schemas ────────────────────────────────────────────────────────────

class OrgWatermarkSettingsRequest(BaseModel):
    position: Optional[str] = None      # top_left|top_right|bottom_left|bottom_right|center
    opacity: Optional[float] = None     # 0.0–1.0
    scale: Optional[float] = None       # 0.05–0.9
    active: Optional[bool] = None
    allow_user_override: Optional[bool] = None
    allowed_plans: Optional[List[str]] = None  # plan names that auto-get override


class UserWatermarkSettingsRequest(BaseModel):
    position: Optional[str] = None
    opacity: Optional[float] = None
    scale: Optional[float] = None
    active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _presign(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    from app.services.dataset_service import generate_presigned_url
    return generate_presigned_url(key)


# ── Org admin endpoints ───────────────────────────────────────────────────────

@router.get("/org")
async def get_org_watermark(user: MLUser = RequireAdmin):
    cfg = await svc.get_or_create_org_config(user.org_id)
    return svc._org_cfg_dict(cfg, url=_presign(cfg.watermark_key) or "")


@router.post("/org/upload")
async def upload_org_watermark(
    file: UploadFile = File(...),
    user: MLUser = RequireAdmin,
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted as watermarks.")
    content = await file.read()
    key = await svc.upload_watermark_image(
        user.org_id, content, file.filename or "watermark.png", file.content_type, owner="org"
    )
    cfg = await svc.get_or_create_org_config(user.org_id)
    cfg.watermark_key = key
    cfg.watermark_name = file.filename or "watermark.png"
    from app.utils.datetime import utc_now
    cfg.updated_at = utc_now()
    await cfg.save()
    return svc._org_cfg_dict(cfg, url=_presign(key) or "")


@router.patch("/org")
async def update_org_watermark_settings(
    body: OrgWatermarkSettingsRequest,
    user: MLUser = RequireAdmin,
):
    cfg = await svc.get_or_create_org_config(user.org_id)
    from app.utils.datetime import utc_now
    if body.position is not None:
        cfg.position = body.position
    if body.opacity is not None:
        cfg.opacity = max(0.0, min(1.0, body.opacity))
    if body.scale is not None:
        cfg.scale = max(0.05, min(0.9, body.scale))
    if body.active is not None:
        cfg.active = body.active
    if body.allow_user_override is not None:
        cfg.allow_user_override = body.allow_user_override
    if body.allowed_plans is not None:
        cfg.allowed_plans = body.allowed_plans
    cfg.updated_at = utc_now()
    await cfg.save()
    return svc._org_cfg_dict(cfg, url=_presign(cfg.watermark_key) or "")


@router.delete("/org/image")
async def delete_org_watermark_image(user: MLUser = RequireAdmin):
    cfg = await svc.get_or_create_org_config(user.org_id)
    cfg.watermark_key = None
    cfg.watermark_name = ""
    from app.utils.datetime import utc_now
    cfg.updated_at = utc_now()
    await cfg.save()
    return {"ok": True}


# ── User override management ──────────────────────────────────────────────────

@router.get("/org/users")
async def list_user_overrides(user: MLUser = RequireAdmin):
    items = await svc.list_user_overrides(user.org_id)
    return items


@router.post("/org/users/{user_id}/grant")
async def grant_user_override(user_id: str, user: MLUser = RequireAdmin):
    cfg = await svc.grant_user_override(user.org_id, user_id, granted_by=user.email)
    return svc._user_cfg_dict(cfg, url=_presign(cfg.watermark_key) or "")


@router.delete("/org/users/{user_id}/revoke")
async def revoke_user_override(user_id: str, user: MLUser = RequireAdmin):
    await svc.revoke_user_override(user.org_id, user_id)
    return {"ok": True}


# ── Per-user (engineer) endpoints ─────────────────────────────────────────────

@router.get("/me")
async def get_my_watermark(user: MLUser = RequireEngineer):
    cfg = await svc.get_user_config(user.email, user.org_id)
    if not cfg:
        return {"has_config": False}
    return {**svc._user_cfg_dict(cfg, url=_presign(cfg.watermark_key) or ""), "has_config": True}


@router.post("/me/upload")
async def upload_my_watermark(
    file: UploadFile = File(...),
    user: MLUser = RequireEngineer,
):
    org_cfg = await svc.get_org_config(user.org_id)
    if not org_cfg or not org_cfg.allow_user_override:
        raise HTTPException(status_code=403, detail="User watermark overrides are not enabled for this organisation.")
    user_cfg = await svc.get_user_config(user.email, user.org_id)
    if not user_cfg:
        raise HTTPException(status_code=403, detail="You have not been granted watermark override permission.")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted as watermarks.")
    content = await file.read()
    key = await svc.upload_watermark_image(
        user.org_id, content, file.filename or "watermark.png", file.content_type, owner=user.email
    )
    from app.utils.datetime import utc_now
    user_cfg.watermark_key = key
    user_cfg.watermark_name = file.filename or "watermark.png"
    user_cfg.updated_at = utc_now()
    await user_cfg.save()
    return svc._user_cfg_dict(user_cfg, url=_presign(key) or "")


@router.patch("/me")
async def update_my_watermark_settings(
    body: UserWatermarkSettingsRequest,
    user: MLUser = RequireEngineer,
):
    user_cfg = await svc.get_user_config(user.email, user.org_id)
    if not user_cfg:
        raise HTTPException(status_code=403, detail="You have not been granted watermark override permission.")
    from app.utils.datetime import utc_now
    if body.position is not None:
        user_cfg.position = body.position
    if body.opacity is not None:
        user_cfg.opacity = max(0.0, min(1.0, body.opacity))
    if body.scale is not None:
        user_cfg.scale = max(0.05, min(0.9, body.scale))
    if body.active is not None:
        user_cfg.active = body.active
    user_cfg.updated_at = utc_now()
    await user_cfg.save()
    return svc._user_cfg_dict(user_cfg, url=_presign(user_cfg.watermark_key) or "")


@router.delete("/me/image")
async def delete_my_watermark_image(user: MLUser = RequireEngineer):
    user_cfg = await svc.get_user_config(user.email, user.org_id)
    if not user_cfg:
        raise HTTPException(status_code=404, detail="No watermark config found.")
    user_cfg.watermark_key = None
    user_cfg.watermark_name = ""
    from app.utils.datetime import utc_now
    user_cfg.updated_at = utc_now()
    await user_cfg.save()
    return {"ok": True}
