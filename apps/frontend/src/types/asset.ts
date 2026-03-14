export type AssetCondition = 'new' | 'excellent' | 'good' | 'fair' | 'poor' | 'damaged'
export type AssetLifecycleStatus = 'active' | 'in_maintenance' | 'checked_out' | 'retired' | 'disposed' | 'written_off'
export type AssetDepreciationMethod = 'straight_line' | 'declining_balance' | 'sum_of_years' | 'units_of_production' | 'none'

export interface AssetValuation {
  id: string
  date: string
  value: number
  method: string
  notes?: string
  recorded_by?: string
  created_at: string
}

export interface AssetMaintenanceRecord {
  id: string
  date: string
  maintenance_type: string
  description: string
  cost?: number
  performed_by?: string
  performed_by_name?: string
  next_due?: string
  attachment_keys: string[]
  notes?: string
  created_at: string
}

export interface AssetTransferRecord {
  id: string
  from_property_id?: string
  from_property_name?: string
  from_unit_id?: string
  from_location?: string
  to_property_id?: string
  to_property_name?: string
  to_unit_id?: string
  to_location?: string
  transferred_by: string
  transferred_by_name?: string
  transferred_at: string
  notes?: string
}

export interface AssetCheckoutRecord {
  id: string
  checked_out_to: string
  checked_out_to_name?: string
  checked_out_at: string
  expected_return?: string
  returned_at?: string
  returned_condition?: string
  notes?: string
}

export interface AssetAuditEntry {
  id: string
  action: string
  actor_id: string
  actor_name?: string
  changes?: Record<string, unknown>
  description?: string
  timestamp: string
}

export interface Asset {
  id: string
  org_id: string
  asset_id: string
  barcode?: string
  qr_code_key?: string
  name: string
  description?: string
  category: string
  subcategory?: string
  tags: string[]
  custom_fields: Record<string, unknown>
  property_id?: string
  property_name?: string
  unit_id?: string
  unit_code?: string
  location?: string
  store_location_id?: string
  store_location_path?: string
  department?: string
  assigned_to?: string
  assigned_to_name?: string
  vendor_name?: string
  manufacturer?: string
  model?: string
  serial_number?: string
  purchase_date?: string
  purchase_cost?: number
  markup_percent: number
  warranty_expiry?: string
  warranty_notes?: string
  condition: AssetCondition
  lifecycle_status: AssetLifecycleStatus
  depreciation_method?: AssetDepreciationMethod
  useful_life_years?: number
  depreciation_rate?: number
  salvage_value?: number
  appreciation_rate?: number
  current_value?: number
  next_service_date?: string
  service_interval_days?: number
  disposed_at?: string
  disposal_reason?: string
  disposal_value?: number
  written_off_at?: string
  write_off_reason?: string
  valuation_history: AssetValuation[]
  maintenance_history: AssetMaintenanceRecord[]
  transfer_history: AssetTransferRecord[]
  checkout_history: AssetCheckoutRecord[]
  audit_trail: AssetAuditEntry[]
  attachment_keys: string[]
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface AssetListResponse {
  items: Asset[]
  total: number
  page: number
  page_size: number
}

export interface AssetCounts {
  total: number
  active: number
  in_maintenance: number
  checked_out: number
  retired: number
  disposed: number
  written_off: number
}

export interface AssetCreatePayload {
  name: string
  category: string
  subcategory?: string
  description?: string
  tags?: string[]
  property_id?: string
  unit_id?: string
  location?: string
  store_location_id?: string
  store_location_path?: string
  department?: string
  assigned_to?: string
  barcode?: string
  vendor_name?: string
  manufacturer?: string
  model?: string
  serial_number?: string
  purchase_date?: string
  purchase_cost?: number
  markup_percent?: number
  warranty_expiry?: string
  warranty_notes?: string
  condition?: AssetCondition
  lifecycle_status?: AssetLifecycleStatus
  depreciation_method?: AssetDepreciationMethod
  useful_life_years?: number
  depreciation_rate?: number
  salvage_value?: number
  appreciation_rate?: number
  next_service_date?: string
  service_interval_days?: number
  notes?: string
}

export interface AssetUpdatePayload extends Partial<AssetCreatePayload> {}

export interface AssetTransferPayload {
  to_property_id?: string
  to_property_name?: string
  to_unit_id?: string
  to_location?: string
  notes?: string
}

export interface AssetCheckoutPayload {
  checked_out_to: string
  checked_out_to_name?: string
  expected_return?: string
  notes?: string
}

export interface AssetCheckinPayload {
  returned_condition?: string
  notes?: string
}

export interface AssetMaintenancePayload {
  date: string
  maintenance_type: string
  description: string
  cost?: number
  performed_by?: string
  performed_by_name?: string
  next_due?: string
  notes?: string
}

export interface AssetValuationPayload {
  date: string
  value: number
  method?: string
  notes?: string
}

export interface AssetDisposePayload {
  disposal_reason: string
  disposal_value?: number
  notes?: string
}

export interface AssetWriteOffPayload {
  write_off_reason: string
  notes?: string
}
