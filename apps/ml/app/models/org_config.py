"""Per-org configuration including the human-readable slug used in API URLs."""
from typing import List, Optional
from datetime import datetime
from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field
from app.utils.datetime import utc_now


class OrgConfig(Document):
    """One document per org_id — created on first access or at signup."""
    org_id: str
    slug: str = ""             # e.g. "mike-a3f7b2c1" → endpoint alias mike-a3f7b2c1/my_model
    org_name: str = ""         # e.g. "Mike_org"
    display_name: str = ""     # friendly display name (same as org_name initially)
    org_type: str = "individual"  # individual | team | enterprise
    previous_slugs: List[str] = Field(default_factory=list)  # old slugs kept as backward-compat aliases
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "org_configs"
        indexes = [
            IndexModel([("org_id", ASCENDING)], unique=True),
            # Partial unique index: only enforces uniqueness for non-empty slugs
            IndexModel(
                [("slug", ASCENDING)],
                name="slug_nonempty_unique",
                unique=True,
                partialFilterExpression={"slug": {"$gt": ""}},
            ),
        ]
