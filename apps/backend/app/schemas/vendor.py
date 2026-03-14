from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr


# ── Vendor Profile schemas ────────────────────────────────────────────────────

class VendorServiceOfferingIn(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    base_rate: Optional[float] = None
    rate_unit: Optional[str] = None
    availability: Optional[str] = None


class VendorDocumentResponse(BaseModel):
    id: str
    doc_type: str
    name: str
    s3_key: str
    url: Optional[str] = None
    uploaded_at: datetime
    expires_at: Optional[datetime] = None
    verified: bool


class VendorTeamMemberIn(BaseModel):
    name: str
    role: str
    email: Optional[str] = None
    phone: Optional[str] = None


class VendorRatingIn(BaseModel):
    stars: int  # 1-5
    review: Optional[str] = None
    ticket_id: Optional[str] = None


class VendorCreateRequest(BaseModel):
    company_name: str
    contact_name: str
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    company_type: str = "individual"
    website: Optional[str] = None
    address: Optional[str] = None
    service_areas: List[str] = []
    service_categories: List[str] = []
    notes: Optional[str] = None


class VendorUpdateRequest(BaseModel):
    company_name: Optional[str] = None
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    company_type: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    service_areas: Optional[List[str]] = None
    service_categories: Optional[List[str]] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    services: Optional[List[VendorServiceOfferingIn]] = None
    team_members: Optional[List[VendorTeamMemberIn]] = None


class VendorProfileResponse(BaseModel):
    id: str
    org_id: str
    user_id: Optional[str] = None
    status: str
    verification_status: str
    company_name: str
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    company_type: str
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    service_areas: List[str]
    service_categories: List[str]
    active_contract_id: Optional[str] = None
    rating_avg: float
    rating_count: int
    notes: Optional[str] = None
    onboarding_completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class VendorProfileListResponse(BaseModel):
    items: List[VendorProfileResponse]
    total: int
    page: int
    page_size: int


class VendorCountsResponse(BaseModel):
    total: int
    approved: int
    pending_review: int
    suspended: int
    draft: int
    inactive: int
    rejected: int


# ── Vendor Listing schemas ────────────────────────────────────────────────────

class VendorListingCreateRequest(BaseModel):
    title: str
    description: str
    service_category: str
    requirements: Optional[str] = None
    application_fee: float = 0.0
    contract_template: Optional[str] = None
    contract_duration_months: Optional[int] = None
    contract_value: Optional[float] = None
    deadline: Optional[datetime] = None
    max_vendors: Optional[int] = None


class VendorListingUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    service_category: Optional[str] = None
    requirements: Optional[str] = None
    application_fee: Optional[float] = None
    contract_template: Optional[str] = None
    contract_duration_months: Optional[int] = None
    contract_value: Optional[float] = None
    deadline: Optional[datetime] = None
    max_vendors: Optional[int] = None


class VendorListingResponse(BaseModel):
    id: str
    org_id: str
    title: str
    description: str
    service_category: str
    requirements: Optional[str] = None
    application_fee: float
    contract_template: Optional[str] = None
    contract_duration_months: Optional[int] = None
    contract_value: Optional[float] = None
    deadline: Optional[datetime] = None
    max_vendors: Optional[int] = None
    status: str
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class VendorListingListResponse(BaseModel):
    items: List[VendorListingResponse]
    total: int
    page: int
    page_size: int


class PublicOrgBranding(BaseModel):
    org_id: str
    name: str
    logo_url: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None


class PublicListingDirectoryResponse(BaseModel):
    org: PublicOrgBranding
    listings: List[VendorListingResponse]


# ── Vendor Application schemas ────────────────────────────────────────────────

class VendorApplicationCreateRequest(BaseModel):
    company_name: str
    contact_name: str
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    service_categories: List[str] = []
    cover_letter: Optional[str] = None


class VendorApplicationRejectRequest(BaseModel):
    rejection_reason: str


class VendorApplicationResponse(BaseModel):
    id: str
    org_id: str
    listing_id: Optional[str] = None
    company_name: str
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    service_categories: List[str]
    cover_letter: Optional[str] = None
    fee_paid: bool
    fee_amount: float
    status: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    vendor_profile_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class VendorApplicationListResponse(BaseModel):
    items: List[VendorApplicationResponse]
    total: int
    page: int
    page_size: int


# ── Vendor Contract schemas ───────────────────────────────────────────────────

class VendorContractCreateRequest(BaseModel):
    title: str
    content: str
    start_date: date
    end_date: date
    auto_renew: bool = False
    renewal_notice_days: int = 30
    contract_fee: float = 0.0


class ContractSignatureResponse(BaseModel):
    signed_by: str
    signed_by_name: str
    signed_at: datetime
    ip_address: Optional[str] = None


class VendorContractResponse(BaseModel):
    id: str
    org_id: str
    vendor_profile_id: str
    listing_id: Optional[str] = None
    title: str
    content: str
    start_date: date
    end_date: date
    auto_renew: bool
    renewal_notice_days: int
    contract_fee: float
    fee_paid: bool
    status: str
    vendor_signature: Optional[ContractSignatureResponse] = None
    org_signature: Optional[ContractSignatureResponse] = None
    sent_at: Optional[datetime] = None
    activated_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None
    termination_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class VendorContractListResponse(BaseModel):
    items: List[VendorContractResponse]
    total: int
    page: int
    page_size: int


# ── Onboarding (public) schemas ───────────────────────────────────────────────

class VendorOnboardingContextResponse(BaseModel):
    vendor_profile_id: str
    company_name: str
    contact_name: str
    contact_email: str
    status: str
    onboarding_completed_at: Optional[datetime] = None


class VendorCompanyDetailsRequest(BaseModel):
    company_name: str
    trading_name: Optional[str] = None
    registration_number: Optional[str] = None
    tax_pin: Optional[str] = None
    company_type: str = "individual"
    contact_name: str
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    service_areas: List[str] = []


class VendorServicesRequest(BaseModel):
    service_categories: List[str] = []
    services: List[VendorServiceOfferingIn] = []


# ── Contract signing (public) schemas ─────────────────────────────────────────

class VendorContractViewResponse(BaseModel):
    id: str
    title: str
    content: str
    status: str
    vendor_profile_id: str
    company_name: str
    start_date: date
    end_date: date
    vendor_signature: Optional[ContractSignatureResponse] = None


class VendorContractSignRequest(BaseModel):
    signature_base64: str  # base64-encoded PNG
    signer_name: str


# ── Account setup (public) schemas ───────────────────────────────────────────

class VendorSetupContextResponse(BaseModel):
    company_name: str
    contact_name: str
    contact_email: str


class VendorActivateRequest(BaseModel):
    password: str


class VendorActivateResponse(BaseModel):
    token: str
    user_id: str
    org_id: Optional[str]
    role: str
    email: str


# ── Vendor Portal schemas ─────────────────────────────────────────────────────

class VendorPortalDashboardResponse(BaseModel):
    open_tickets: int
    active_contracts: int
    pending_documents: int
    total_ratings: int
    rating_avg: float


class SuspendRequest(BaseModel):
    reason: Optional[str] = None
