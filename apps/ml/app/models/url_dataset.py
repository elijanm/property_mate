"""URL-sourced dataset — fetched on creation + on a configurable schedule, cached in S3."""
from typing import Optional
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class UrlDataset(Document):
    class Settings:
        name = "url_datasets"

    org_id: str
    name: str
    slug: Optional[str] = None          # URL-friendly identifier, unique per org — mirrors DatasetProfile.slug
    dataset_profile_id: Optional[str] = None  # companion DatasetProfile ID (for manual upload entries)
    source_url: str
    refresh_interval_hours: int = 24    # 0 = manual only
    # For JSON arrays of objects: field inside each object that holds a media URL to download.
    # e.g. "image_url" fetches each image and stores it alongside a manifest.json
    url_field: Optional[str] = None
    max_items: Optional[int] = None     # cap large datasets; None = no limit
    # Populated after first successful fetch
    content_type: str = "unknown"       # detected from Content-Type header
    s3_prefix: Optional[str] = None     # e.g. "org123/url_datasets/<id>/"
    status: str = "pending"             # pending | fetching | ready | error
    last_fetched_at: Optional[datetime] = None
    next_fetch_at: Optional[datetime] = None
    fetch_error: Optional[str] = None
    item_count: Optional[int] = None
    size_bytes: Optional[int] = None
    # SHA-256 of the raw response body from the last successful fetch.
    # Used for change detection — if the hash differs from the previous fetch,
    # on_change hooks (webhook / retrain) are fired.
    content_hash: Optional[str] = None
    # Change-detection hooks — configured per dataset
    on_change_webhook_url: Optional[str] = None     # POST this URL when content changes
    on_change_retrain: Optional[str] = None         # trainer_name to retrain when content changes
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
