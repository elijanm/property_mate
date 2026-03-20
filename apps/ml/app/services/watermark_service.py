"""
Watermark service.

apply_watermark(image_bytes, watermark_bytes, position, opacity, scale) → bytes
get_org_config(org_id) → OrgWatermarkConfig | None
get_user_config(user_id, org_id) → UserWatermarkConfig | None
get_effective_config(org_id, user_id) → (OrgWatermarkConfig | None, UserWatermarkConfig | None)
maybe_watermark(org_id, user_id, image_bytes, mime) → bytes  (returns original if no watermark)
"""
from __future__ import annotations

import io
from typing import Optional, Tuple

import structlog

from app.models.watermark import OrgWatermarkConfig, UserWatermarkConfig

logger = structlog.get_logger(__name__)


def apply_watermark(
    image_bytes: bytes,
    watermark_bytes: bytes,
    position: str = "bottom_right",
    opacity: float = 0.5,
    scale: float = 0.2,
) -> bytes:
    """Composite a watermark onto an image and return JPEG bytes."""
    from PIL import Image, ImageEnhance

    base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    wm = Image.open(io.BytesIO(watermark_bytes)).convert("RGBA")

    # Scale watermark to fraction of base width
    scale = max(0.05, min(0.9, scale))
    wm_w = max(1, int(base.width * scale))
    ratio = wm_w / wm.width
    wm_h = max(1, int(wm.height * ratio))
    wm = wm.resize((wm_w, wm_h), Image.LANCZOS)

    # Apply opacity to alpha channel
    r, g, b, a = wm.split()
    a = ImageEnhance.Brightness(a).enhance(max(0.0, min(1.0, opacity)))
    wm = Image.merge("RGBA", (r, g, b, a))

    # Compute paste position
    pad = max(10, int(base.width * 0.02))
    positions: dict[str, Tuple[int, int]] = {
        "top_left":     (pad, pad),
        "top_right":    (base.width - wm_w - pad, pad),
        "bottom_left":  (pad, base.height - wm_h - pad),
        "bottom_right": (base.width - wm_w - pad, base.height - wm_h - pad),
        "center":       ((base.width - wm_w) // 2, (base.height - wm_h) // 2),
    }
    pos = positions.get(position, positions["bottom_right"])

    # Overlay
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    overlay.paste(wm, pos, wm)
    composited = Image.alpha_composite(base, overlay)

    out = io.BytesIO()
    composited.convert("RGB").save(out, format="JPEG", quality=92)
    return out.getvalue()


async def get_org_config(org_id: str) -> Optional[OrgWatermarkConfig]:
    return await OrgWatermarkConfig.find_one(OrgWatermarkConfig.org_id == org_id)


async def get_or_create_org_config(org_id: str) -> OrgWatermarkConfig:
    cfg = await get_org_config(org_id)
    if not cfg:
        cfg = OrgWatermarkConfig(org_id=org_id)
        await cfg.insert()
    return cfg


async def get_user_config(user_id: str, org_id: str) -> Optional[UserWatermarkConfig]:
    return await UserWatermarkConfig.find_one(
        UserWatermarkConfig.user_id == user_id,
        UserWatermarkConfig.org_id == org_id,
    )


async def _user_has_plan_override(user_id: str, org_id: str, allowed_plans: list) -> bool:
    """Return True if the user's active plan is in the allowed_plans list."""
    if not allowed_plans or not user_id:
        return False
    from app.models.ml_plan import MLUserPlan
    user_plan = await MLUserPlan.find_one(MLUserPlan.user_email == user_id)
    return bool(user_plan and user_plan.plan_name and user_plan.plan_name in allowed_plans)


async def maybe_watermark(
    org_id: str,
    user_id: Optional[str],
    image_bytes: bytes,
    mime: str,
) -> bytes:
    """
    Apply watermark if configured.  Returns original bytes if:
    - mime is not an image
    - org watermark is inactive

    When no watermark image is set, falls back to a text overlay "Mldock.io".
    Original bytes are never modified — watermark is composited in memory only.
    """
    if not mime.startswith("image/"):
        return image_bytes

    org_cfg = await get_org_config(org_id)
    position = org_cfg.position if org_cfg else "bottom_right"
    scale = org_cfg.scale if org_cfg else 0.25

    # Determine effective watermark key.
    # Custom image is only used when admin has explicitly enabled it (active=True).
    # The text fallback "Mldock.io" always applies regardless of active flag —
    # it is platform-level brand protection on all served content.
    wm_key: Optional[str] = None
    # Text watermark uses full opacity — the pill alpha provides the transparency.
    # Custom image watermark uses admin-configured opacity.
    opacity = org_cfg.opacity if (org_cfg and org_cfg.active and org_cfg.watermark_key) else 1.0
    if org_cfg and org_cfg.active:
        wm_key = org_cfg.watermark_key

        # Check user override: explicit grant OR plan-based auto-grant
        if user_id and org_cfg.allow_user_override:
            user_cfg = await get_user_config(user_id, org_id)
            has_override = (user_cfg and user_cfg.active) or \
                           await _user_has_plan_override(user_id, org_id, org_cfg.allowed_plans)
            if has_override and user_cfg and user_cfg.watermark_key:
                wm_key = user_cfg.watermark_key
                position = user_cfg.position or position
                opacity = user_cfg.opacity if user_cfg.opacity is not None else opacity
                scale = user_cfg.scale if user_cfg.scale is not None else scale

    # Download custom watermark image, fall back to text "Mldock.io"
    wm_bytes: Optional[bytes] = None
    if wm_key:
        try:
            wm_bytes = await _download_from_s3(wm_key)
        except Exception as exc:
            logger.warning("watermark_download_failed", key=wm_key, error=str(exc))

    if wm_bytes is None:
        # No custom image — use Shutterstock-style tiled diagonal text watermark
        try:
            return apply_tiled_text_watermark(image_bytes, "Mldock.io")
        except Exception as exc:
            logger.warning("watermark_tiled_apply_failed", error=str(exc))
            return image_bytes

    try:
        return apply_watermark(image_bytes, wm_bytes, position, opacity, scale)
    except Exception as exc:
        logger.warning("watermark_apply_failed", error=str(exc))
        return image_bytes


def _load_font(font_size: int = 40):
    """Load best available bold font, falling back to Pillow built-in."""
    from PIL import ImageFont
    _font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for fp in _font_paths:
        try:
            return ImageFont.truetype(fp, font_size)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=font_size)
    except TypeError:
        return ImageFont.load_default()


def apply_tiled_text_watermark(image_bytes: bytes, text: str = "Mldock.io") -> bytes:
    """
    Shutterstock-style watermark: semi-transparent text tiled diagonally across the full image.
    Text is rendered at ~45° rotation and repeated in a grid pattern.
    """
    import math
    from PIL import Image, ImageDraw

    base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    W, H = base.size

    # Font size proportional to image width (clamp 18–72px)
    font_size = max(18, min(72, W // 15))
    font = _load_font(font_size)

    # Measure one text stamp
    dummy = Image.new("RGBA", (1, 1))
    draw_dummy = ImageDraw.Draw(dummy)
    bbox = draw_dummy.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Build a single rotated stamp tile on transparent background
    # Add padding so tiles don't crowd each other
    pad_x = int(tw * 0.8)
    pad_y = int(th * 1.8)
    tile_w = tw + pad_x
    tile_h = th + pad_y

    stamp = Image.new("RGBA", (tile_w, tile_h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stamp)
    # White text with shadow for readability on any background
    sx = pad_x // 2
    sy = pad_y // 2
    # Shadow
    sd.text((sx + 1, sy + 1), text, font=font, fill=(0, 0, 0, 100))
    # Main text — semi-transparent white
    sd.text((sx, sy), text, font=font, fill=(255, 255, 255, 160))

    # Rotate ~-30° (Shutterstock uses ~-30° diagonal)
    angle = -30
    rotated = stamp.rotate(angle, expand=True)
    rw, rh = rotated.size

    # Build overlay by tiling the rotated stamp
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gap_x = int(rw * 1.1)
    gap_y = int(rh * 1.1)
    for y in range(-rh, H + rh, gap_y):
        for x in range(-rw, W + rw, gap_x):
            overlay.paste(rotated, (x, y), rotated)

    composited = Image.alpha_composite(base, overlay)
    out = io.BytesIO()
    composited.convert("RGB").save(out, format="JPEG", quality=92)
    return out.getvalue()


def _generate_text_watermark(text: str) -> bytes:
    """Render text as a single transparent PNG watermark pill (used for custom-position overlay)."""
    from PIL import Image, ImageDraw

    font_size = 40
    font = _load_font(font_size)

    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), text, font=font)
    pad = 14
    w = bbox[2] - bbox[0] + pad * 2
    h = bbox[3] - bbox[1] + pad * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=8, fill=(0, 0, 0, 175))
    draw.text((pad, pad), text, font=font, fill=(255, 255, 255, 255))

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def _download_from_s3(key: str) -> bytes:
    import aioboto3
    from app.core.config import settings
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        resp = await s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
        return await resp["Body"].read()


async def upload_watermark_image(org_id: str, content: bytes, filename: str, mime: str, owner: str = "org") -> str:
    """Upload a watermark PNG to S3 and return its key."""
    import uuid
    from app.core.config import settings
    import aioboto3

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    key = f"{org_id}/watermarks/{owner}/{uuid.uuid4()}.{ext}"

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        await s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=content,
            ContentType=mime or "image/png",
        )
    return key


async def list_user_overrides(org_id: str) -> list:
    """List all user watermark overrides for an org."""
    items = await UserWatermarkConfig.find(
        UserWatermarkConfig.org_id == org_id,
    ).to_list()
    return [_user_cfg_dict(i) for i in items]


async def grant_user_override(org_id: str, user_id: str, granted_by: str) -> UserWatermarkConfig:
    from app.utils.datetime import utc_now
    cfg = await get_user_config(user_id, org_id)
    if not cfg:
        cfg = UserWatermarkConfig(user_id=user_id, org_id=org_id, granted_by=granted_by, granted_at=utc_now())
        await cfg.insert()
    else:
        cfg.granted_by = granted_by
        cfg.granted_at = utc_now()
        cfg.updated_at = utc_now()
        await cfg.save()
    return cfg


async def revoke_user_override(org_id: str, user_id: str) -> None:
    cfg = await get_user_config(user_id, org_id)
    if cfg:
        await cfg.delete()


def _org_cfg_dict(cfg: OrgWatermarkConfig, url: str = "") -> dict:
    return {
        "id": str(cfg.id),
        "org_id": cfg.org_id,
        "has_watermark": bool(cfg.watermark_key),
        "watermark_name": cfg.watermark_name,
        "watermark_url": url,
        "position": cfg.position,
        "opacity": cfg.opacity,
        "scale": cfg.scale,
        "active": cfg.active,
        "allow_user_override": cfg.allow_user_override,
        "allowed_plans": cfg.allowed_plans,
        "updated_at": cfg.updated_at.isoformat(),
    }


def _user_cfg_dict(cfg: UserWatermarkConfig, url: str = "") -> dict:
    return {
        "id": str(cfg.id),
        "user_id": cfg.user_id,
        "org_id": cfg.org_id,
        "has_watermark": bool(cfg.watermark_key),
        "watermark_name": cfg.watermark_name,
        "watermark_url": url,
        "position": cfg.position,
        "opacity": cfg.opacity,
        "scale": cfg.scale,
        "active": cfg.active,
        "granted_by": cfg.granted_by,
        "granted_at": cfg.granted_at.isoformat() if cfg.granted_at else None,
    }
