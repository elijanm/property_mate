"""
S3 presigned URL utilities.

generate_presigned_url(key) — generate a fresh presigned URL from a stored S3 key.
refresh_output_urls(outputs, image_keys) — replace any expired *_url fields in an
    outputs dict using the corresponding stored *_key values.
"""
from __future__ import annotations

import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)


def generate_presigned_url(key: str, expiry: int = 604800) -> str:
    """
    Return a URL to access an S3/MinIO object.

    - If MEDIA_BASE_URL is set (e.g. http://media.mldock.io), returns a plain
      public URL: MEDIA_BASE_URL/BUCKET/key — no presigning, no expiry.
    - Otherwise generates a presigned GET URL using S3_PUBLIC_ENDPOINT_URL
      (falls back to S3_ENDPOINT_URL).  Default expiry: 7 days.
    """
    if settings.MEDIA_BASE_URL:
        base = settings.MEDIA_BASE_URL.rstrip("/")
        return f"{base}/{settings.S3_BUCKET}/{key}"

    import boto3
    endpoint = (settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL).rstrip("/")
    try:
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        )
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET, "Key": key},
            ExpiresIn=expiry,
        )
    except Exception as exc:
        logger.warning("presign_failed", key=key, error=str(exc))
        return ""


def refresh_output_urls(outputs: dict, image_keys: dict[str, str]) -> dict:
    """
    Return a copy of `outputs` with all *_url fields replaced by fresh
    presigned URLs generated from the corresponding stored *_key values.

    Convention: image_keys maps "original_key" → s3_key, so we
    replace outputs["original_url"] with a fresh URL.
    """
    if not image_keys:
        return outputs
    result = dict(outputs)
    for key_field, s3_key in image_keys.items():
        if not s3_key:
            continue
        # "original_key" → "original_url"
        url_field = key_field[:-4] + "_url"   # strip "_key", add "_url"
        if url_field in result or True:        # always refresh if key exists
            fresh = generate_presigned_url(s3_key)
            if fresh:
                result[url_field] = fresh
    return result
