from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.org import InventoryConfig, LedgerSettings, SignatureConfig, TaxConfig
from app.models.property import Address, BillingSettings, LeaseDefaults, PaymentConfig, PricingDefaults, UnitPolicyDefaults, UtilityDefaults, WingConfig
from app.models.store import StoreConfig


class LateFeeSettingRequest(BaseModel):
    enabled: bool = False
    grace_days: int = Field(ge=0, default=5)
    fee_type: str = "fixed"
    fee_value: float = Field(ge=0, default=500.0)
    max_applications: int = Field(ge=0, default=1)


class LateFeeSettingResponse(BaseModel):
    enabled: bool
    grace_days: int
    fee_type: str
    fee_value: float
    max_applications: int


# ── Unit template (used in Breeze create request) ────────────────────────────

class UnitTemplateRequest(BaseModel):
    template_name: str
    wings: Optional[List[str]] = None  # None = apply to all wings (or wingless)
    floors_start: int = Field(ge=0)
    floors_end: int = Field(ge=0)
    units_per_floor: Optional[int] = Field(default=None, ge=1)
    unit_numbers: Optional[List[str]] = None  # explicit unit identifiers per floor
    unit_type: str = "standard"
    rent_base: Optional[float] = Field(default=None, ge=0)
    deposit_amount: Optional[float] = Field(default=None, ge=0)
    deposit_rule: Optional[str] = None
    size: Optional[float] = Field(default=None, ge=0)
    furnished: bool = False
    is_premium: bool = False

    @field_validator("floors_end")
    @classmethod
    def end_gte_start(cls, v: int, info) -> int:
        if "floors_start" in info.data and v < info.data["floors_start"]:
            raise ValueError("floors_end must be >= floors_start")
        return v

    def unit_identifiers(self) -> List[str]:
        if self.unit_numbers:
            return self.unit_numbers
        if self.units_per_floor:
            return [str(i) for i in range(1, self.units_per_floor + 1)]
        return []


# ── Property create request (Breeze config) ──────────────────────────────────

class PropertyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    property_type: str = "residential"
    region: str
    timezone: str = "Africa/Nairobi"
    address: Address
    wings: Optional[List[WingConfig]] = None
    unit_templates: List[UnitTemplateRequest] = Field(min_length=1)
    pricing_defaults: PricingDefaults = Field(default_factory=PricingDefaults)
    utility_defaults: UtilityDefaults = Field(default_factory=UtilityDefaults)
    billing_settings: BillingSettings = Field(default_factory=BillingSettings)
    lease_defaults: Optional[LeaseDefaults] = None
    unit_policies: Optional[UnitPolicyDefaults] = None
    tax_config: Optional[TaxConfig] = None
    ledger_settings: Optional[LedgerSettings] = None
    manager_ids: Optional[List[str]] = None


# ── Responses ────────────────────────────────────────────────────────────────

class WingConfigResponse(BaseModel):
    name: str
    floors_start: int
    floors_end: int


class InventoryConfigResponse(BaseModel):
    serial_merge_mode: str = "keep_target"
    serial_split_remainder_pct: float = 0.0


class PropertyResponse(BaseModel):
    id: str
    org_id: str
    name: str
    property_type: str
    region: str
    timezone: str
    address: Address
    wings: List[WingConfig]
    pricing_defaults: PricingDefaults
    utility_defaults: UtilityDefaults
    billing_settings: BillingSettings
    lease_defaults: LeaseDefaults
    unit_policies: UnitPolicyDefaults
    tax_config: Optional[TaxConfig] = None
    ledger_settings: Optional[LedgerSettings] = None
    manager_ids: List[str]
    unit_count: int
    color: Optional[str] = None
    payment_config: Optional[PaymentConfig] = None
    signature_config: Optional[SignatureConfig] = None
    installed_apps: List[str] = []
    inventory_config: InventoryConfigResponse = Field(default_factory=InventoryConfigResponse)
    store_config: StoreConfig = Field(default_factory=StoreConfig)
    late_fee_setting: Optional[LateFeeSettingResponse] = None
    status: str
    created_at: datetime
    updated_at: datetime


class PropertyInventoryConfigUpdateRequest(BaseModel):
    serial_merge_mode: Optional[str] = None
    serial_split_remainder_pct: Optional[float] = None


class SignatureConfigUpdateRequest(BaseModel):
    signatory_name: Optional[str] = None
    signatory_title: Optional[str] = None


class PaymentConfigUpdateRequest(BaseModel):
    paybill_number: Optional[str] = None
    till_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_branch: Optional[str] = None
    online_payment_enabled: Optional[bool] = None
    account_reference_type: Optional[str] = None
    custom_account_reference: Optional[str] = None


class PropertyCreateResponse(BaseModel):
    property: PropertyResponse
    units_generated: int = 0
    job_id: Optional[str] = None  # present when generation is async


class PropertyUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    property_type: Optional[str] = None
    region: Optional[str] = None
    timezone: Optional[str] = None
    address: Optional[Address] = None
    wings: Optional[List[WingConfig]] = None
    pricing_defaults: Optional[PricingDefaults] = None
    utility_defaults: Optional[UtilityDefaults] = None
    billing_settings: Optional[BillingSettings] = None
    lease_defaults: Optional[LeaseDefaults] = None
    unit_policies: Optional[UnitPolicyDefaults] = None
    tax_config: Optional[TaxConfig] = None
    ledger_settings: Optional[LedgerSettings] = None
    manager_ids: Optional[List[str]] = None
    color: Optional[str] = None
    status: Optional[str] = None


class PropertyListResponse(BaseModel):
    items: List[PropertyResponse]
    total: int
    page: int
    page_size: int
