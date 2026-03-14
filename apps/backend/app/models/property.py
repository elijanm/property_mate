import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.models.org import InventoryConfig, LedgerSettings, SignatureConfig, TaxConfig  # noqa: F401 — re-exported for use in schemas
from app.models.store import StoreConfig  # noqa: F401
from app.utils.datetime import utc_now


class Address(BaseModel):
    street: str
    city: str
    state: str
    country: str = "Kenya"
    postal_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class WingConfig(BaseModel):
    name: str
    floors_start: int
    floors_end: int


class PricingTier(BaseModel):
    """One band in a tiered metered-rate schedule."""
    from_units: float = 0.0          # lower bound (inclusive)
    to_units: Optional[float] = None  # upper bound (exclusive); None = unbounded
    rate: float                       # KES per unit consumed in this band


class UtilityDetail(BaseModel):
    type: str  # "shared" | "metered" | "subscription"
    rate: Optional[float] = None
    allocation_rule: Optional[str] = None  # "equal" | "per_unit" | "by_size"
    unit: Optional[str] = None  # e.g. "KWh", "m³", "KES/mo"
    label: Optional[str] = None  # display name e.g. "Water"
    tiers: Optional[List[PricingTier]] = None  # tiered pricing; only used when type="metered"
    current_reading: Optional[float] = None    # last known meter value; only used when type="metered"
    income_account: Optional[str] = None       # chart-of-accounts code this utility bills to e.g. "4200"
    deposit: Optional[float] = None            # one-time refundable deposit for this specific utility


class CustomUtilityDetail(UtilityDetail):
    """A user-defined utility entry (e.g. gym_membership, laundry)."""
    key: str  # unique slug within the property, e.g. "gym_membership"


class UtilityDefaults(BaseModel):
    electricity: Optional[UtilityDetail] = None
    water: Optional[UtilityDetail] = None
    gas: Optional[UtilityDetail] = None
    internet: Optional[UtilityDetail] = None
    garbage: Optional[UtilityDetail] = None
    security: Optional[UtilityDetail] = None
    custom: List[CustomUtilityDetail] = []  # arbitrary user-defined utilities


class BillingSettings(BaseModel):
    invoice_day: int = 1
    due_days: int = 7
    grace_days: int = 3
    late_fee_type: str = "flat"  # "flat" | "percentage"
    late_fee_value: float = 500.0
    show_tiered_breakdown: bool = False  # include tier-by-tier calculation in PDF invoices


class PricingDefaults(BaseModel):
    rent_base: Optional[float] = None
    deposit_rule: str = "1x_rent"
    deposit_amount: Optional[float] = None
    deposit_refundable: bool = True
    deposit_refund_policy: str = "wear_and_tear"  # "none" | "wear_and_tear" | "full_inspection"
    deposit_refund_days: int = 30
    utility_deposit: Optional[float] = None  # one-time refundable utility deposit
    utility_deposit_income_account: Optional[str] = None  # chart-of-accounts code for utility deposit receipts


class LeaseDefaults(BaseModel):
    min_duration_months: int = 1
    default_duration_months: int = 12
    notice_days: int = 30
    termination_fee_type: str = "none"  # "none" | "flat" | "months_rent"
    termination_fee_value: Optional[float] = None
    auto_renewal: bool = True
    rent_escalation_pct: float = 0.0
    escalation_review_months: int = 12


class UnitPolicyDefaults(BaseModel):
    pet_policy: str = "not_allowed"  # "not_allowed" | "allowed" | "allowed_with_deposit"
    pet_deposit: Optional[float] = None
    smoking_allowed: bool = False
    parking_available: bool = False
    parking_fee: Optional[float] = None
    amenities: List[str] = []
    guest_policy: Optional[str] = None
    move_in_inspection_days: int = 15  # days tenant has to log pre-move-in defects


class LateFeeSetting(BaseModel):
    enabled: bool = False
    grace_days: int = 5            # days after due_date before late fee applies
    fee_type: str = "fixed"        # "fixed" | "percentage"
    fee_value: float = 500.0       # KES amount or percentage of balance_due
    max_applications: int = 1      # max times to apply per invoice (0 = unlimited)


class MeterSettings(BaseModel):
    """Per-property meter reading configuration."""
    meter_reader_service_provider_id: Optional[str] = None  # SP to assign meter tickets to
    show_previous_meter_reading: bool = True  # show previous reading to field reader


class PaymentConfig(BaseModel):
    """Payment collection details shown on the contract and used in online payment flows."""
    paybill_number: Optional[str] = None
    till_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_branch: Optional[str] = None
    online_payment_enabled: bool = False  # allows STK push from the public onboarding wizard
    account_reference_type: str = "unit_code"  # "unit_code" | "tenant_id" | "custom"
    custom_account_reference: Optional[str] = None


class Property(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    name: str
    property_type: str = "residential"
    region: str
    timezone: str = "Africa/Nairobi"
    address: Address
    wings: List[WingConfig] = []
    pricing_defaults: PricingDefaults = Field(default_factory=PricingDefaults)
    utility_defaults: UtilityDefaults = Field(default_factory=UtilityDefaults)
    billing_settings: BillingSettings = Field(default_factory=BillingSettings)
    lease_defaults: LeaseDefaults = Field(default_factory=LeaseDefaults)
    unit_policies: UnitPolicyDefaults = Field(default_factory=UnitPolicyDefaults)
    payment_config: Optional[PaymentConfig] = None
    meter_settings: MeterSettings = Field(default_factory=MeterSettings)
    # Optional property-level overrides; if None, org-level defaults apply
    signature_config: Optional[SignatureConfig] = None   # overrides org-level if present
    tax_config: Optional[TaxConfig] = None
    ledger_settings: Optional[LedgerSettings] = None
    manager_ids: List[str] = []
    unit_count: int = 0
    installed_apps: List[str] = []       # e.g. ["inventory-assets", "voice-agent", "store-management"]
    inventory_config: InventoryConfig = Field(default_factory=InventoryConfig)
    store_config: StoreConfig = Field(default_factory=StoreConfig)
    late_fee_setting: LateFeeSetting = Field(default_factory=LateFeeSetting)
    color: Optional[str] = None  # hex color e.g. "#7c3aed"
    status: str = "active"
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "properties"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
        ]
