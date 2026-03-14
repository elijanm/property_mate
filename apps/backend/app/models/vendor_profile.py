import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class VendorServiceOffering(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    category: str
    description: Optional[str] = None
    base_rate: Optional[float] = None
    rate_unit: Optional[str] = None  # hour | day | job | sqm
    availability: Optional[str] = None  # e.g. "Mon-Fri 8am-6pm"


class VendorDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    doc_type: str  # certificate_of_incorporation | tax_compliance | insurance | nca_cert | other
    name: str
    s3_key: str
    uploaded_at: datetime = Field(default_factory=utc_now)
    expires_at: Optional[datetime] = None
    verified: bool = False


class VendorTeamMember(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    role: str
    email: Optional[str] = None
    phone: Optional[str] = None


class VendorRating(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    rated_by: str  # user_id
    rated_by_name: Optional[str] = None
    stars: int  # 1-5
    review: Optional[str] = None
    ticket_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class VendorAuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action: str
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None
    description: str
    created_at: datetime = Field(default_factory=utc_now)


class VendorProfile(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    user_id: Optional[str] = None

    # Status lifecycle
    status: str = "draft"
    # draft | pending_review | approved | suspended | inactive | rejected
    verification_status: str = "unverified"
    # unverified | in_review | verified | failed

    # Company info
    company_name: str
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    company_type: str = "individual"
    # individual | sole_proprietor | partnership | limited_company

    # Contact
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None

    # Scope
    service_areas: List[str] = []
    service_categories: List[str] = []

    # Tokens
    invite_token: Optional[str] = None
    setup_link_token: Optional[str] = None

    # Contract
    active_contract_id: Optional[str] = None

    # Ratings aggregate
    rating_avg: float = 0.0
    rating_count: int = 0

    # Embedded lists
    services: List[VendorServiceOffering] = []
    documents: List[VendorDocument] = []
    team_members: List[VendorTeamMember] = []
    ratings: List[VendorRating] = []
    audit_trail: List[VendorAuditEntry] = []

    notes: Optional[str] = None
    created_by: Optional[str] = None
    onboarding_completed_at: Optional[datetime] = None

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "vendor_profiles"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("service_categories", ASCENDING)]),
            IndexModel(
                [("user_id", ASCENDING)],
                sparse=True,
            ),
            IndexModel(
                [("invite_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"invite_token": {"$type": "string"}},
            ),
            IndexModel(
                [("setup_link_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"setup_link_token": {"$type": "string"}},
            ),
        ]
