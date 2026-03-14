from contextlib import asynccontextmanager
from typing import AsyncGenerator
import aioboto3
from botocore.exceptions import ClientError
from app.core.config import settings


_session = aioboto3.Session()


@asynccontextmanager
async def get_s3_client() -> AsyncGenerator:
    async with _session.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    ) as client:
        yield client


async def ensure_bucket_exists() -> None:
    """Create the media bucket if it does not exist yet."""
    async with get_s3_client() as s3:
        try:
            await s3.head_bucket(Bucket=settings.s3_bucket_name)
        except ClientError:
            await s3.create_bucket(Bucket=settings.s3_bucket_name)


async def generate_presigned_url(key: str, expires: int | None = None) -> str:
    """Return a presigned GET URL for the given S3 key.

    The URL is signed against the internal endpoint but the host is rewritten
    to the public endpoint so browsers can reach it directly.
    """
    async with get_s3_client() as s3:
        url: str = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket_name, "Key": key},
            ExpiresIn=expires or settings.s3_presigned_url_expires,
        )

    public_base = (settings.s3_public_endpoint_url or settings.s3_endpoint_url).rstrip("/")
    internal_base = settings.s3_endpoint_url.rstrip("/")
    if public_base != internal_base:
        url = url.replace(internal_base, public_base, 1)

    return url


async def upload_file(key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to S3 under the given key."""
    async with get_s3_client() as s3:
        await s3.put_object(
            Bucket=settings.s3_bucket_name,
            Key=key,
            Body=body,
            ContentType=content_type,
        )


async def download_file(key: str) -> bytes:
    """Download raw bytes from S3 for the given key."""
    async with get_s3_client() as s3:
        response = await s3.get_object(Bucket=settings.s3_bucket_name, Key=key)
        async with response["Body"] as stream:
            return await stream.read()


def s3_path(org_id: str, resource_type: str, resource_id: str, filename: str) -> str:
    return f"{org_id}/{resource_type}/{resource_id}/{filename}"
