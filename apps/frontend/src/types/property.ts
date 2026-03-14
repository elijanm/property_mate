import type { InventoryConfig, TaxConfig, LedgerSettings, SignatureConfig } from './org'
export type { InventoryConfig, TaxConfig, LedgerSettings, SignatureConfig }
export type { StoreConfig } from './store'
import type { StoreConfig } from './store'

export interface Address {
  street: string
  city: string
  state: string
  country: string
  postal_code?: string
  latitude?: number
  longitude?: number
}

export interface WingConfig {
  name: string
  floors_start: number
  floors_end: number
}

export interface PricingTier {
  from_units: number    // lower bound (inclusive)
  to_units?: number     // upper bound (exclusive); undefined = unbounded
  rate: number          // KES per unit in this band
}

export interface UtilityDetail {
  type: 'shared' | 'metered' | 'subscription'
  rate?: number
  allocation_rule?: string
  unit?: string
  label?: string
  tiers?: PricingTier[] // only meaningful when type='metered'
  current_reading?: number
  income_account?: string  // chart-of-accounts code, e.g. "4200"
  deposit?: number         // one-time refundable deposit for this utility
}

export interface CustomUtilityDetail extends UtilityDetail {
  key: string  // unique slug within the property, e.g. 'gym_membership'
}

export interface UtilityDefaults {
  electricity?: UtilityDetail
  water?: UtilityDetail
  gas?: UtilityDetail
  internet?: UtilityDetail
  garbage?: UtilityDetail
  security?: UtilityDetail
  custom: CustomUtilityDetail[]
}

export interface BillingSettings {
  invoice_day: number
  due_days: number
  grace_days: number
  late_fee_type: 'flat' | 'percentage'
  late_fee_value: number
  show_tiered_breakdown: boolean   // include tier-by-tier calculation in PDF invoices
}

export interface PricingDefaults {
  rent_base?: number
  deposit_rule: '1x_rent' | '2x_rent' | '3x_rent' | 'custom'
  deposit_amount?: number
  deposit_refundable: boolean
  deposit_refund_policy: 'none' | 'wear_and_tear' | 'full_inspection'
  deposit_refund_days: number
  utility_deposit?: number
  utility_deposit_income_account?: string  // ledger account for utility deposit receipts
}

export interface LeaseDefaults {
  min_duration_months: number
  default_duration_months: number
  notice_days: number
  termination_fee_type: 'none' | 'flat' | 'months_rent'
  termination_fee_value?: number
  auto_renewal: boolean
  rent_escalation_pct: number
  escalation_review_months: number
}

export interface UnitPolicyDefaults {
  pet_policy: 'not_allowed' | 'allowed' | 'allowed_with_deposit'
  pet_deposit?: number
  smoking_allowed: boolean
  parking_available: boolean
  parking_fee?: number
  amenities: string[]
  guest_policy?: string
}

export interface PaymentConfig {
  paybill_number?: string
  till_number?: string
  bank_name?: string
  bank_account?: string
  bank_branch?: string
  online_payment_enabled: boolean
  account_reference_type: 'unit_code' | 'tenant_id' | 'custom'
  custom_account_reference?: string
}

export interface LateFeeSetting {
  enabled: boolean
  grace_days: number
  fee_type: 'fixed' | 'percentage'
  fee_value: number
  max_applications: number
}

export interface Property {
  id: string
  org_id: string
  name: string
  property_type: 'residential' | 'commercial' | 'mixed'
  region: string
  timezone: string
  address: Address
  wings: WingConfig[]
  pricing_defaults: PricingDefaults
  utility_defaults: UtilityDefaults
  billing_settings: BillingSettings
  lease_defaults: LeaseDefaults
  unit_policies: UnitPolicyDefaults
  tax_config?: TaxConfig
  ledger_settings?: LedgerSettings
  manager_ids: string[]
  unit_count: number
  color?: string
  payment_config?: PaymentConfig
  signature_config?: SignatureConfig
  installed_apps: string[]
  inventory_config: InventoryConfig
  store_config: StoreConfig
  late_fee_setting?: LateFeeSetting
  status: 'active' | 'inactive' | 'archived'
  created_at: string
  updated_at: string
}

export interface UnitTemplateRequest {
  template_name: string
  wings?: string[]
  floors_start: number
  floors_end: number
  units_per_floor?: number
  unit_numbers?: string[]
  unit_type: string
  rent_base?: number
  deposit_amount?: number
  deposit_rule?: string
  size?: number
  furnished: boolean
  is_premium: boolean
}

export interface PropertyCreateRequest {
  name: string
  property_type: 'residential' | 'commercial' | 'mixed'
  region: string
  timezone: string
  address: Address
  wings?: WingConfig[]
  unit_templates: UnitTemplateRequest[]
  pricing_defaults?: PricingDefaults
  utility_defaults?: UtilityDefaults
  billing_settings: BillingSettings
  lease_defaults?: LeaseDefaults
  unit_policies?: UnitPolicyDefaults
  tax_config?: TaxConfig
  ledger_settings?: LedgerSettings
  manager_ids?: string[]
}

export interface PropertyCreateResponse {
  property: Property
  units_generated: number
  job_id?: string
}

export interface PropertyUpdateRequest {
  name?: string
  property_type?: string
  region?: string
  timezone?: string
  address?: Partial<Address>
  wings?: WingConfig[]
  pricing_defaults?: Partial<PricingDefaults>
  utility_defaults?: Partial<UtilityDefaults>
  billing_settings?: Partial<BillingSettings>
  lease_defaults?: Partial<LeaseDefaults>
  unit_policies?: Partial<UnitPolicyDefaults>
  tax_config?: TaxConfig
  ledger_settings?: LedgerSettings
  manager_ids?: string[]
  color?: string
  status?: string
}
