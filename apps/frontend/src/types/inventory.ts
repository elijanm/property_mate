export interface InventoryAuditEntry {
  id: string
  action: string
  actor_id: string
  actor_name?: string
  changes?: Record<string, unknown>
  description?: string
  timestamp: string
}

export type InventoryStatus = 'active' | 'discontinued' | 'out_of_stock' | 'on_order'
export type ShipmentStatus = 'draft' | 'pending_driver' | 'driver_signed' | 'pending_receiver' | 'delivered' | 'cancelled'
export type HazardClass = 'harmful' | 'poisonous' | 'flammable' | 'explosive' | 'corrosive' | 'fragile' | 'perishable' | 'controlled'
export type StockMovementType =
  | 'stock_in' | 'stock_out' | 'adjustment' | 'transfer_out' | 'transfer_in'
  | 'reserve' | 'issue' | 'return' | 'damaged' | 'lost' | 'expired' | 'write_off'
  | 'merge' | 'split'

export interface InventoryVariant {
  id: string
  name: string
  sku?: string
  image_key?: string
  image_url?: string   // presigned S3 URL — populated by backend at response time
  purchase_cost?: number
  selling_price?: number
  attributes: Record<string, string>
  status: 'active' | 'discontinued'
  created_at: string
  updated_at: string
}

export interface InventoryVariantPayload {
  name: string
  sku?: string
  purchase_cost?: number
  selling_price?: number
  attributes?: Record<string, string>
}

export interface StockSerial {
  id: string
  serial_number: string
  status: 'in_stock' | 'dispatched' | 'returned' | 'damaged' | 'depleted' | 'merged' | 'split'
  location_key?: string
  movement_ref?: string
  added_at: string
  updated_at: string
  // Weight tracking
  gross_weight_kg?: number
  tare_weight_kg?: number
  net_weight_kg?: number
  quantity_remaining?: number
  dispatch_gross_kg?: number
  dispatch_net_kg?: number
  weight_variance_kg?: number
  weight_variance_pct?: number
  weight_flagged: boolean
  weight_flag_reason?: string
  // Parentage
  parent_serial_id?: string
  child_serial_ids: string[]
  // Per-serial pricing recorded at stock-in
  purchase_cost?: number
  selling_price?: number
  margin_pct?: number
  variant_id?: string
  // Store location
  store_location_id?: string
  store_location_path?: string
}

export interface SerialMergePayload {
  target_serial?: string
  source_serials: string[]
  new_serial_number?: string
  notes?: string
}

export interface SerialSplitPayload {
  source_serial: string
  new_serials: { serial_number: string; quantity: number }[]
  notes?: string
}

export interface StockBatch {
  id: string
  batch_number: string
  lot_number?: string
  supplier_name?: string
  purchase_date?: string
  expiry_date?: string
  purchase_cost: number
  quantity_received: number
  quantity_remaining: number
  notes?: string
  created_at: string
}

export interface StockLevel {
  location_key: string
  location_label: string
  property_id?: string
  unit_id?: string
  quantity: number
  reserved_quantity: number
  available_quantity: number
}

export interface StockMovement {
  id: string
  movement_type: StockMovementType
  quantity: number
  unit_of_measure: string
  reference_no?: string
  batch_id?: string
  from_location_label?: string
  to_location_label?: string
  unit_cost?: number
  total_cost?: number
  performed_by_name?: string
  notes?: string
  serial_numbers: string[]
  serial_count: number
  shipment_id?: string
  serial_weights: Record<string, number>
  serial_quantities_taken: Record<string, number>
  weight_variance_events: Array<Record<string, unknown>>
  movement_net_qty?: number
  movement_dispatch_qty?: number
  movement_variance_pct?: number
  movement_weight_flagged: boolean
  store_location_id?: string
  store_location_path?: string
  created_at: string
}

export interface InventoryItem {
  id: string
  org_id: string
  item_id: string
  barcode?: string
  qr_code_key?: string
  name: string
  description?: string
  category: string
  subcategory?: string
  tags: string[]
  custom_fields: Record<string, unknown>
  hazard_classes: HazardClass[]
  safety_notes?: string
  requires_controlled_handling: boolean
  unit_of_measure: string
  units_per_package: number
  sku?: string
  vendor_name?: string
  manufacturer?: string
  manufacturer_part_number?: string
  purchase_cost?: number
  markup_percent: number
  selling_price?: number
  min_stock_level: number
  max_stock_level?: number
  reorder_point: number
  reorder_quantity: number
  storage_location?: string
  store_location_id?: string
  store_location_path?: string
  property_id?: string
  property_name?: string
  is_serialized: boolean
  weight_per_unit?: number
  weight_tracking_enabled: boolean
  tare_tracking_enabled: boolean
  weight_variance_soft_pct: number
  weight_variance_hard_pct: number
  status: InventoryStatus
  batch_tracking_enabled: boolean
  expiry_tracking_enabled: boolean
  total_quantity: number
  total_reserved: number
  total_available: number
  total_serial_count: number
  stock_levels: StockLevel[]
  batches: StockBatch[]
  movements: StockMovement[]
  serials: StockSerial[]
  variants: InventoryVariant[]
  audit_trail: InventoryAuditEntry[]
  attachment_keys: string[]
  image_key?: string
  image_url?: string   // presigned S3 URL
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
  is_low_stock: boolean
  has_expired_batches: boolean
}

export interface InventoryListResponse {
  items: InventoryItem[]
  total: number
  page: number
  page_size: number
}

export interface InventoryCounts {
  total: number
  active: number
  low_stock: number
  out_of_stock: number
  expiring_soon: number
}

export interface ShipmentItem {
  id: string
  item_id: string
  item_name: string
  quantity: number
  unit_of_measure: string
  serial_numbers: string[]
  weight_per_unit?: number
  line_weight: number
}

export interface ShipmentSignature {
  signed_by_name: string
  signed_at: string
  ip_address?: string
  signature_key: string
}

export interface StockShipment {
  id: string
  org_id: string
  reference_number: string
  movement_type: 'stock_out' | 'transfer'
  items: ShipmentItem[]
  total_weight: number
  tracking_number?: string
  driver_name: string
  driver_phone?: string
  driver_email?: string
  vehicle_number?: string
  destination: string
  receiver_name?: string
  receiver_phone?: string
  receiver_email?: string
  status: ShipmentStatus
  driver_sign_token?: string
  driver_signature?: ShipmentSignature
  receiver_sign_token?: string
  receiver_signature?: ShipmentSignature
  pdf_key?: string
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
  driver_sign_url?: string
  receiver_sign_url?: string
  pdf_url?: string
}

export interface ShipmentListResponse {
  items: StockShipment[]
  total: number
  page: number
  page_size: number
}

export interface ShipmentItemPayload {
  item_id: string
  item_name: string
  quantity: number
  unit_of_measure: string
  serial_numbers?: string[]
  weight_per_unit?: number
}

export interface ShipmentCreatePayload {
  movement_type?: 'stock_out' | 'transfer'
  items: ShipmentItemPayload[]
  tracking_number?: string
  driver_name: string
  driver_phone?: string
  driver_email?: string
  vehicle_number?: string
  destination: string
  receiver_name?: string
  receiver_phone?: string
  receiver_email?: string
  notes?: string
}

export interface ShipmentPublicContext {
  reference_number: string
  movement_type: string
  tracking_number?: string
  vehicle_number?: string
  driver_name: string
  destination: string
  receiver_name?: string
  items: ShipmentItem[]
  total_weight: number
  status: string
  org_name?: string
  org_logo_url?: string
  notes?: string
}

export interface ShipmentSignPayload {
  signed_by_name: string
  signature_b64: string
}

export interface InventoryItemCreatePayload {
  name: string
  category: string
  subcategory?: string
  description?: string
  tags?: string[]
  hazard_classes?: HazardClass[]
  safety_notes?: string
  requires_controlled_handling?: boolean
  unit_of_measure?: string
  units_per_package?: number
  barcode?: string
  sku?: string
  vendor_name?: string
  manufacturer?: string
  manufacturer_part_number?: string
  purchase_cost?: number
  markup_percent?: number
  min_stock_level?: number
  max_stock_level?: number
  reorder_point?: number
  reorder_quantity?: number
  storage_location?: string
  store_location_id?: string
  store_location_path?: string
  property_id?: string
  is_serialized?: boolean
  weight_per_unit?: number
  weight_tracking_enabled?: boolean
  tare_tracking_enabled?: boolean
  weight_variance_soft_pct?: number
  weight_variance_hard_pct?: number
  batch_tracking_enabled?: boolean
  expiry_tracking_enabled?: boolean
  notes?: string
}

export interface InventoryItemUpdatePayload extends Partial<InventoryItemCreatePayload> {
  status?: InventoryStatus
}

export interface StockInPayload {
  quantity: number
  location_key: string
  location_label: string
  property_id?: string
  unit_cost?: number
  reference_no?: string
  batch_number?: string
  lot_number?: string
  expiry_date?: string
  serial_numbers?: string[]
  serial_weights?: Record<string, number>
  serial_tare_weights?: Record<string, number>
  serial_purchase_costs?: Record<string, number>
  serial_selling_prices?: Record<string, number>
  serial_variant_ids?: Record<string, string>
  movement_net_qty?: number
  store_location_id?: string
  store_location_path?: string
  notes?: string
}

export interface StockOutPayload {
  quantity: number
  location_key: string
  reference_no?: string
  batch_id?: string
  serial_numbers?: string[]
  serial_quantities?: Record<string, number>
  serial_dispatch_weights?: Record<string, number>
  movement_dispatch_qty?: number
  force_override?: boolean
  store_location_id?: string
  store_location_path?: string
  notes?: string
}

export interface StockAdjustPayload {
  quantity: number
  location_key: string
  location_label: string
  property_id?: string
  notes?: string
}

export interface StockTransferPayload {
  quantity: number
  from_location_key: string
  from_location_label: string
  to_location_key: string
  to_location_label: string
  to_property_id?: string
  batch_id?: string
  serial_numbers?: string[]
  notes?: string
}

export interface StockDamagedPayload {
  quantity: number
  location_key: string
  reason?: string
  notes?: string
}
