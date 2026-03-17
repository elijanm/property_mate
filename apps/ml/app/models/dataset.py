"""Dataset collection models — profile, collectors, entries."""
import uuid
import re
import secrets
from typing import Optional, List
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug: lowercase, spaces/underscores→hyphens, strip specials."""
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "dataset"


class DatasetField(BaseModel):
    """A single capture slot in the dataset (e.g. 'Front view of cow')."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str                                    # shown to collector
    instruction: str = ""                         # guidance text / photo tips
    type: str = "image"                           # image | video | media | file | text | number
                                                  # media = accept both image + video
    # image / file settings
    capture_mode: str = "both"                    # camera_only | upload_only | both
    required: bool = True
    # description settings
    description_mode: str = "none"               # none | free_text | preset
    description_presets: List[str] = []           # e.g. ["Healthy","Sick","Injured"]
    description_required: bool = False
    order: int = 0
    # Repeat settings
    repeatable: bool = False                      # can be submitted multiple times
    max_repeats: int = 0                          # 0 = unlimited; N = cap at N submissions
    # Model validation
    validation_model: Optional[str] = None        # trainer_name of deployed model to run on upload
    validation_labels: List[str] = []             # accepted prediction labels; empty = accept any
    validation_message: str = ""                  # rejection message shown to collector


class DatasetProfile(Document):
    org_id: str = ""
    name: str
    slug: Optional[str] = None                    # URL-friendly identifier, unique per org
    description: str = ""
    category: str = ""
    fields: List[DatasetField] = []
    status: str = "active"                        # draft | active | closed

    # Visibility & sharing
    visibility: str = "private"                   # private | public
    # Derived datasets — set when cloned or referenced from a public dataset
    source_dataset_id: Optional[str] = None       # original dataset this was cloned/referenced from
    reference_type: Optional[str] = None          # clone | reference
    # Cached stats for public listing (updated on entry submit)
    entry_count_cache: int = 0

    # Contributor task discovery — when True, appears in annotator task feed
    discoverable: bool = False
    # Optional allowlist of annotator emails; empty = open to all contributors
    contributor_allowlist: List[str] = []

    # Points / incentive system
    points_enabled: bool = False
    points_per_entry: int = 1                     # points awarded per field submission
    points_redemption_info: str = ""              # e.g. "100 pts = KES 10 airtime"

    # Location tracking
    require_location: bool = False                # if True, collector is prompted to share GPS location
    location_purpose: str = ""                    # shown to collector: why location is needed

    created_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "dataset_profiles"


class DatasetCollector(Document):
    org_id: str = ""
    dataset_id: str
    email: str
    name: str = ""
    token: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    status: str = "pending"                       # pending | active | completed
    invited_at: datetime = Field(default_factory=utc_now)
    last_active_at: Optional[datetime] = None
    entry_count: int = 0
    points_earned: int = 0
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "dataset_collectors"


class EntryLocation(BaseModel):
    """GPS or IP-derived location captured at submission time."""
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy: Optional[float] = None             # GPS accuracy in metres
    source: str = "ip"                           # "gps" | "ip"
    ip_address: Optional[str] = None
    country: Optional[str] = None               # ISO 3166-1 alpha-2 e.g. "KE"
    country_name: Optional[str] = None
    city: Optional[str] = None
    timezone: Optional[str] = None
    isp: Optional[str] = None


class DatasetEntry(Document):
    org_id: str = ""
    dataset_id: str
    collector_id: str
    field_id: str
    file_key: Optional[str] = None               # S3 object key
    file_mime: Optional[str] = None
    file_size_bytes: Optional[int] = None        # raw file size in bytes (set at upload time)
    text_value: Optional[str] = None             # text / number fields
    description: Optional[str] = None            # collector-provided description
    points_awarded: int = 0
    location: Optional[EntryLocation] = None     # GPS or IP-based location metadata
    captured_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "dataset_entries"
