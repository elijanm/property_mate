import type { PricingTier } from '@/types/property'
export type { PricingTier }

export type UnitStatus = 'vacant' | 'reserved' | 'occupied' | 'inactive'

export interface UtilityOverrideDetail {
  type: 'shared' | 'metered' | 'subscription'
  rate?: number
  unit?: string
  label?: string
  income_account?: string  // chart-of-accounts code override for this unit
  tiers?: PricingTier[]    // tiered pricing when type='metered'
  deposit?: number         // per-utility deposit override for this unit
}

export interface UtilityOverride {
  electricity?: UtilityOverrideDetail
  water?: UtilityOverrideDetail
  gas?: UtilityOverrideDetail
  internet?: UtilityOverrideDetail
  garbage?: UtilityOverrideDetail
  security?: UtilityOverrideDetail
}

export interface MeterReadingCacheEntry {
  value: number
  read_at: string       // ISO datetime
  read_by: string       // user_id
  read_by_name: string  // resolved display name
}

export interface Unit {
  id: string
  org_id: string
  property_id: string
  unit_code: string
  wing?: string
  floor: number
  unit_number: string
  unit_type: string
  size?: number
  furnished: boolean
  is_premium: boolean
  status: UnitStatus
  rent_base?: number
  deposit_amount?: number
  deposit_rule?: string
  utility_deposit?: number
  utility_overrides?: UtilityOverride
  meter_reading_cache?: Record<string, MeterReadingCacheEntry>
  meter_id?: string
  iot_device_id?: string
  created_at: string
  updated_at: string
}

export interface UnitUpdateRequest {
  rent_base?: number
  deposit_amount?: number
  deposit_rule?: string
  utility_deposit?: number
  status?: UnitStatus
  unit_type?: string
  size?: number
  furnished?: boolean
  is_premium?: boolean
  utility_overrides?: UtilityOverride
  meter_id?: string
  iot_device_id?: string
}

export interface UtilityLineItem {
  key: string
  label: string
  type: string
  rate?: number
  unit_label?: string
  income_account?: string
  deposit?: number
}

export interface UnitPricingResponse {
  unit_id: string
  unit_code: string
  rent_amount: number
  deposit_amount: number
  deposit_rule: string
  utility_deposit?: number
  utilities: UtilityLineItem[]
  prorated_rent: number
  prorated_days: number
  days_in_month: number
  total_move_in: number
}

export interface BulkUnitUpdate {
  unit_id: string
  updates: UnitUpdateRequest
}

export interface BulkUpdateRequest {
  updates: BulkUnitUpdate[]
}

export interface BulkUpdateResponse {
  updated: number
  failed: number
  errors: Array<{ unit_id: string; error: string }>
}
