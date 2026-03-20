"""Consent template and signed consent record models."""
from __future__ import annotations
import secrets
from typing import Optional, List
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now

GLOBAL_ORG_ID = "__global__"


class ConsentTemplate(Document):
    org_id: str                          # "__global__" for platform defaults
    name: str
    type: str = "individual"             # "individual" | "group"
    title: str = "Photography Consent Agreement"
    body: str                            # plain text with {{placeholders}}
    requires_subject_signature: bool = True
    requires_collector_signature: bool = True
    allow_email_signing: bool = True
    active: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "consent_templates"


class ConsentSignature(BaseModel):
    signer_name: str
    signer_email: Optional[str] = None
    signature_data: str                  # base64 PNG of canvas drawing
    signed_at: datetime = Field(default_factory=utc_now)
    ip_address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class ConsentRecord(Document):
    org_id: str
    dataset_id: str
    collector_id: str
    template_id: str
    consent_type: str = "individual"     # "individual" | "group"
    token: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    email_token: Optional[str] = None   # separate token for email signing link

    # Subject info
    subject_name: str
    subject_email: Optional[str] = None
    representative_name: Optional[str] = None   # for groups or minors

    # Rendered body (template merged with subject details)
    rendered_body: str = ""

    # Signatures
    subject_signature: Optional[ConsentSignature] = None
    collector_signature: Optional[ConsentSignature] = None

    # Generated PDF
    pdf_key: Optional[str] = None       # S3 key

    # Offline signing — photo of physically-signed paper form
    offline_photo_key: Optional[str] = None  # S3 key of the photo

    # Linked DatasetEntry IDs covered by this consent
    entry_ids: List[str] = []

    # Status
    status: str = "pending"             # pending | subject_signed | complete | void

    # Metadata
    ip_address: Optional[str] = None
    email_sent_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "consent_records"
        indexes = [
            [("dataset_id", 1), ("collector_id", 1)],
            [("token", 1)],
            [("email_token", 1)],
        ]
