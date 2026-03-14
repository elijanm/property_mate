import uuid
from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class Onboarding(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    unit_id: Optional[str] = None
    tenant_id: Optional[str] = None
    lease_id: Optional[str] = None
    status: str = "initiated"  # initiated | invited | unit_reserved | contract_drafted | kyc_submitted | signed | activated | cancelled
    initiated_by: str  # user_id
    notes: Optional[str] = None

    # ── Invite ────────────────────────────────────────────────────────────────
    invite_token: Optional[str] = None    # secure random token for the onboarding wizard URL
    invite_email: Optional[str] = None   # email the invite was sent to
    invite_sent_at: Optional[datetime] = None

    # ── KYC / identity verification ───────────────────────────────────────────
    id_type: Optional[str] = None         # national_id | passport | drivers_license
    id_number: Optional[str] = None
    id_front_key: Optional[str] = None    # S3 key for ID front image
    id_back_key: Optional[str] = None     # S3 key for ID back image
    selfie_key: Optional[str] = None      # S3 key for selfie image

    # ── Personal details (captured via wizard) ────────────────────────────────
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None   # ISO date string
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None

    # ── Contract signing ──────────────────────────────────────────────────────
    signature_key: Optional[str] = None        # S3 key for the drawn tenant signature PNG
    signed_at: Optional[datetime] = None
    # ── Owner / agent countersignature ────────────────────────────────────────
    owner_signature_key: Optional[str] = None  # S3 key for owner/agent signature PNG
    owner_signed_at: Optional[datetime] = None
    owner_signed_by: Optional[str] = None      # display name (e.g. "John Doe")

    # ── Document verification ─────────────────────────────────────────────────
    verification_code: Optional[str] = None    # 8-char hex code printed in the PDF annex
    doc_fingerprint: Optional[str] = None      # SHA-256 of key contract fields
    pdf_hash: Optional[str] = None             # SHA-256 of raw generated PDF bytes
    pdf_key: Optional[str] = None              # S3 key for the generated lease PDF

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "onboardings"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("tenant_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("unit_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING)]),
            IndexModel([("invite_token", ASCENDING)], sparse=True),
        ]
