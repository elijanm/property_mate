"""Dataset collection models — profile, collectors, entries."""
import uuid
import secrets
from typing import Optional, List
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


class DatasetField(BaseModel):
    """A single capture slot in the dataset (e.g. 'Front view of cow')."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str                                    # shown to collector
    instruction: str = ""                         # guidance text / photo tips
    type: str = "image"                           # image | file | text | number
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
    description: str = ""
    category: str = ""
    fields: List[DatasetField] = []
    status: str = "active"                        # draft | active | closed

    # Points / incentive system
    points_enabled: bool = False
    points_per_entry: int = 1                     # points awarded per field submission
    points_redemption_info: str = ""              # e.g. "100 pts = KES 10 airtime"

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


class DatasetEntry(Document):
    org_id: str = ""
    dataset_id: str
    collector_id: str
    field_id: str
    file_key: Optional[str] = None               # S3 object key
    file_mime: Optional[str] = None
    text_value: Optional[str] = None             # text / number fields
    description: Optional[str] = None            # collector-provided description
    points_awarded: int = 0
    captured_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "dataset_entries"
