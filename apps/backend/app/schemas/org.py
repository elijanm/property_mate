from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.org import AIConfig, BillingConfig, BusinessDetails, LedgerSettings, SignatureConfig, TaxConfig, TicketCategoryConfig


class DepositInterestSettingRequest(BaseModel):
    enabled: bool = False
    annual_rate_pct: float = Field(ge=0, default=0.0)
    compound: bool = False
    apply_on_refund: bool = True


class DepositInterestSettingResponse(BaseModel):
    enabled: bool
    annual_rate_pct: float
    compound: bool
    apply_on_refund: bool


class OrgUpdateRequest(BaseModel):
    business: Optional[BusinessDetails] = None
    tax_config: Optional[TaxConfig] = None
    ledger_settings: Optional[LedgerSettings] = None
    ticket_categories: Optional[List[TicketCategoryConfig]] = None
    setup_complete: Optional[bool] = None


class AIConfigResponse(BaseModel):
    provider: str
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key_set: bool = False   # True if an api_key is stored (key itself never returned)


class AIConfigUpdateRequest(BaseModel):
    provider: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None


class OrgResponse(BaseModel):
    org_id: str
    business: Optional[BusinessDetails]
    tax_config: TaxConfig
    ledger_settings: LedgerSettings
    billing_config: BillingConfig = Field(default_factory=BillingConfig)
    signature_config: SignatureConfig = Field(default_factory=SignatureConfig)
    ticket_categories: List[TicketCategoryConfig] = []
    voice_api_audit_enabled: bool = True
    deposit_interest: Optional[DepositInterestSettingResponse] = None
    ai_config: AIConfigResponse = Field(default_factory=lambda: AIConfigResponse(provider="custom"))
    setup_complete: bool


class VoiceSettingsUpdateRequest(BaseModel):
    voice_api_audit_enabled: Optional[bool] = None


class SignatureConfigUpdateRequest(BaseModel):
    signatory_name: Optional[str] = None
    signatory_title: Optional[str] = None


class BillingConfigUpdateRequest(BaseModel):
    auto_generation_enabled: Optional[bool] = None
    preparation_day: Optional[int] = None
    preparation_hour: Optional[int] = None
    preparation_minute: Optional[int] = None
    timezone: Optional[str] = None
    payment_grace_days: Optional[int] = None



