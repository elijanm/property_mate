from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class OnboardingDocumentsResponse(BaseModel):
    onboarding_id: str
    status: str
    id_front_url: Optional[str] = None
    id_back_url: Optional[str] = None
    selfie_url: Optional[str] = None
    signature_url: Optional[str] = None
    signed_at: Optional[datetime] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None


class OnboardingCreateRequest(BaseModel):
    property_id: str
    tenant_id: Optional[str] = None
    lease_id: Optional[str] = None
    notes: Optional[str] = None


class OnboardingReserveUnitRequest(BaseModel):
    unit_id: str


class OnboardingInviteRequest(BaseModel):
    email: str


class OnboardingDetailsRequest(BaseModel):
    id_type: Optional[str] = None          # national_id | passport | drivers_license
    id_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None    # ISO date string
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None


class OnboardingSignRequest(BaseModel):
    """Signature data as a base64 PNG data URL (data:image/png;base64,...)."""
    signature_data: str


class OnboardingOwnerSignRequest(BaseModel):
    """Owner/agent countersignature data URL + optional display name."""
    signature_data: str
    signed_by: Optional[str] = None  # display name; falls back to business_details.name


class OnboardingResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_id: Optional[str]
    tenant_id: Optional[str]
    lease_id: Optional[str]
    status: str
    initiated_by: str
    notes: Optional[str]
    # invite
    invite_email: Optional[str]
    invite_sent_at: Optional[datetime]
    invite_link: Optional[str]      # computed: app_base_url/onboarding/{token}
    # KYC
    id_type: Optional[str]
    id_number: Optional[str]
    id_front_url: Optional[str]     # presigned S3 URL
    id_back_url: Optional[str]
    selfie_url: Optional[str]
    # personal
    first_name: Optional[str]
    last_name: Optional[str]
    date_of_birth: Optional[str]
    phone: Optional[str]
    emergency_contact_name: Optional[str]
    emergency_contact_phone: Optional[str]
    created_at: datetime
    updated_at: datetime


class UtilityContractLine(BaseModel):
    """One utility line for the contract display."""
    key: str
    label: str
    type: str            # shared | metered | subscription
    rate: Optional[float] = None
    unit_label: Optional[str] = None
    deposit: Optional[float] = None


class PaymentConfigSummary(BaseModel):
    """Resolved payment config sent to the public onboarding wizard."""
    paybill_number: Optional[str] = None
    till_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_branch: Optional[str] = None
    online_payment_enabled: bool = False
    account_reference: Optional[str] = None  # resolved value (unit_code, tenant_id, or custom)


class LeaseSummary(BaseModel):
    """Lease details included in the public onboarding response for contract display."""
    lease_id: str
    status: Optional[str] = None
    reference_no: Optional[str] = None
    unit_code: Optional[str]
    property_name: Optional[str]
    property_address: Optional[str]
    rent_amount: float
    deposit_amount: float
    utility_deposit: Optional[float]
    start_date: Optional[str]
    end_date: Optional[str]
    notes: Optional[str]
    # Billing / late fees (from property.billing_settings)
    invoice_day: int = 1
    due_days: int = 7
    grace_days: int = 3
    late_fee_type: str = "flat"        # flat | percentage
    late_fee_value: float = 0.0
    # Lease defaults (from property.lease_defaults)
    notice_days: int = 30
    termination_fee_type: str = "none"  # none | flat | months_rent
    termination_fee_value: Optional[float] = None
    deposit_refund_days: int = 30
    # Utilities — merged property defaults + unit overrides
    utilities: List[UtilityContractLine] = []
    payment_config: Optional[PaymentConfigSummary] = None


class OnboardingPayRequest(BaseModel):
    phone: str
    amount: float
    sandbox: bool = False


class OnboardingPayResponse(BaseModel):
    payment_id: str
    status: str
    message: str


class OnboardingPayStatusResponse(BaseModel):
    status: str            # pending | completed | failed
    lease_status: str
    message: Optional[str] = None


class OnboardingPublicResponse(BaseModel):
    """Returned by the public invite-token endpoint — no sensitive org data."""
    id: str
    status: str
    invite_email: Optional[str]
    # personal details (pre-fill)
    first_name: Optional[str]
    last_name: Optional[str]
    date_of_birth: Optional[str]
    phone: Optional[str]
    emergency_contact_name: Optional[str]
    emergency_contact_phone: Optional[str]
    # KYC
    id_type: Optional[str]
    id_number: Optional[str]
    has_id_front: bool
    has_id_back: bool
    has_selfie: bool
    has_signature: bool
    has_owner_signature: bool = False
    # Org branding for contract letterhead
    org_name: Optional[str] = None
    org_logo_url: Optional[str] = None
    org_phone: Optional[str] = None
    org_email: Optional[str] = None
    org_address: Optional[str] = None
    # lease contract summary (populated when lease_id is linked)
    lease: Optional[LeaseSummary]


class OnboardingVerifyResponse(BaseModel):
    """Returned by the public verification endpoints."""
    onboarding_id: str
    is_authentic: bool
    tenant_name: Optional[str] = None
    property_name: Optional[str] = None
    unit_code: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    rent_amount: Optional[float] = None
    signed_at: Optional[datetime] = None
    owner_signed_at: Optional[datetime] = None
    owner_signed_by: Optional[str] = None
    doc_fingerprint: Optional[str] = None
    status: str


class OnboardingListResponse(BaseModel):
    items: List[OnboardingResponse]
    total: int
    page: int
    page_size: int
