// Framework Asset Management — TypeScript types

export type KvaRange = '22-35' | '40-55' | '60-75' | '80-110' | '120-200' | '250-330'

export type FrameworkContractStatus = 'active' | 'draft' | 'expired' | 'suspended'

export type AssetOperationalStatus = 'operational' | 'under_maintenance' | 'fault' | 'standby' | 'decommissioned'

export type ServiceType = 'biannual_a' | 'biannual_b' | 'quarterly' | 'corrective' | 'emergency'

export type WorkOrderStatus = 'draft' | 'assigned' | 'en_route' | 'pre_inspection' | 'pending_approval' | 'in_progress' | 'completed' | 'signed_off' | 'cancelled'

export type ScheduleStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'overdue' | 'cancelled'

export type SlaLevel = 'exceptional' | 'very_good' | 'marginal' | 'unsatisfactory' | 'defective'

export interface FrameworkSite {
  id: string
  site_code: string
  site_name: string
  region: string
  physical_address?: string
  gps_lat?: number
  gps_lng?: number
  contact_name?: string
  contact_phone?: string
  notes?: string
}

export interface Schedule4Entry {
  id: string
  site_code?: string
  site_name: string
  region: string
  brand?: string
  kva_rating?: string
  cost_a: number   // 2 PM services/year
  cost_b: number   // 2 technical inspections/year
  cost_c: number   // Annual unlimited attendance
  cost_d: number   // Computed: A + B + C
  notes?: string
}

export interface FrameworkContract {
  id: string
  org_id: string
  name: string
  client_name: string
  contract_number: string
  contract_start: string
  contract_end: string
  region: string
  description?: string
  status: FrameworkContractStatus
  regions: string[]
  sites: FrameworkSite[]
  schedule4_entries: Schedule4Entry[]
  total_assets: number
  active_work_orders: number
  overdue_schedules: number
  sla_score?: number
  color?: string
  created_at: string
  updated_at: string
}

export interface FrameworkAsset {
  id: string
  org_id: string
  framework_id: string
  // Identity
  asset_tag: string
  site_name: string
  site_code: string
  // Technical specs
  kva_rating: KvaRange
  engine_make: string
  engine_model?: string
  serial_number?: string
  manufacture_year?: number
  fuel_type: 'diesel' | 'petrol' | 'gas' | 'hybrid'
  // Location
  region: string
  physical_address?: string
  gps_lat?: number
  gps_lng?: number
  site_contact_name?: string
  site_contact_phone?: string
  // Operational status
  operational_status: AssetOperationalStatus
  installation_date?: string
  warranty_expiry?: string
  // Service tracking
  service_frequency: 'monthly' | 'quarterly' | 'biannual' | 'annual'
  last_service_date?: string
  next_service_date?: string
  last_service_type?: ServiceType
  total_runtime_hours?: number
  // Notes
  notes?: string
  image_key?: string
  created_at: string
  updated_at: string
}

export interface MaintenanceSchedule {
  id: string
  org_id: string
  framework_id: string
  asset_id: string
  asset_site_name: string
  asset_region: string
  service_type: ServiceType
  scheduled_date: string
  status: ScheduleStatus
  work_order_id?: string
  assigned_vendor_id?: string
  assigned_vendor_name?: string
  estimated_duration_hours?: number
  notes?: string
  created_at: string
}

export interface RouteStop {
  sequence: number
  asset_id: string
  site_name: string
  site_code: string
  physical_address: string
  gps_lat?: number
  gps_lng?: number
  estimated_arrival?: string
  actual_arrival?: string
  status: 'pending' | 'completed' | 'skipped'
  technician_notes?: string
  schedule_id?: string
}

export interface WorkOrder {
  id: string
  org_id: string
  framework_id: string
  work_order_number: string
  title: string
  service_type: ServiceType
  status: WorkOrderStatus
  assigned_vendor_id?: string
  assigned_vendor_name?: string
  technician_names?: string[]
  route_stops: RouteStop[]
  planned_date: string
  start_date?: string
  completion_date?: string
  total_assets: number
  parts_used: WorkOrderPart[]
  labor_hours?: number
  transport_cost?: number
  accommodation_cost?: number
  total_cost?: number
  pre_inspection?: PreInspection
  client_signature_url?: string
  technician_signature_url?: string
  report_notes?: string
  created_at: string
  updated_at: string
}

export interface PreInspectionItem {
  id: string
  part_name: string
  part_number?: string
  kva_range?: string
  quantity: number
  estimated_unit_cost: number
  estimated_total_cost: number
  notes?: string
}

export interface PreInspection {
  inspection_date: string
  technician_name: string
  condition_notes: string
  items: PreInspectionItem[]
  estimated_total: number
  status: 'submitted' | 'approved' | 'rejected'
  approval_notes?: string
  approved_by?: string
  approved_at?: string
  submitted_at: string
}

export interface WorkOrderPart {
  id: string
  part_name: string
  part_number?: string
  quantity: number
  unit_cost: number
  total_cost: number
  kva_range?: KvaRange
}

export interface SlaRecord {
  id: string
  org_id: string
  framework_id: string
  asset_id: string
  site_name: string
  period_quarter: string          // e.g. "2026-Q1"
  response_time_hours?: number
  resolution_time_hours?: number
  sla_level: SlaLevel
  events: SlaEvent[]
  penalty_percentage: number
  penalty_amount?: number
  notes?: string
  created_at: string
}

export interface SlaEvent {
  id: string
  event_type: string
  occurred_at: string
  penalty_pct: number
  description: string
  resolved: boolean
}

export interface SparePartsPricing {
  id: string
  org_id: string
  framework_id: string
  part_name: string
  part_number?: string
  category: string
  kva_pricing: Partial<Record<KvaRange, number>>
  unit: string
  notes?: string
}

export interface TransportCostEntry {
  id: string
  org_id: string
  framework_id: string
  region: string
  description: string
  road_rate_per_km?: number
  air_rate?: number
  fixed_allowance?: number
  notes?: string
}

export interface FrameworkStats {
  total_assets: number
  operational: number
  under_maintenance: number
  fault: number
  decommissioned: number
  overdue_schedules: number
  open_work_orders: number
  completed_this_month: number
  avg_sla_score: number
  total_penalties_qtd: number
}

export interface FrameworkCreateRequest {
  name: string
  client_name: string
  contract_number: string
  contract_start: string
  contract_end: string
  region: string
  description?: string
  color?: string
}

export interface FrameworkAssetCreateRequest {
  site_name: string
  site_code: string
  kva_rating: KvaRange
  engine_make: string
  engine_model?: string
  serial_number?: string
  manufacture_year?: number
  fuel_type: 'diesel' | 'petrol' | 'gas' | 'hybrid'
  region: string
  physical_address?: string
  gps_lat?: number
  gps_lng?: number
  site_contact_name?: string
  site_contact_phone?: string
  service_frequency: 'monthly' | 'quarterly' | 'biannual' | 'annual'
  installation_date?: string
  warranty_expiry?: string
  notes?: string
}

export interface SparePartsKitItem {
  id: string
  part_number?: string
  part_name: string
  quantity: number
  unit: string
  unit_price?: number
  notes?: string
}

export type KitValidityType = 'standard' | 'emergency' | 'seasonal' | 'annual'

export interface SparePartsKit {
  id: string
  org_id: string
  framework_id: string
  kit_name: string
  validity_type: KitValidityType
  engine_make?: string
  engine_model?: string
  kva_min?: number
  kva_max?: number
  applicable_service_types: string[]
  site_code?: string
  items: SparePartsKitItem[]
  notes?: string
  created_at: string
  updated_at: string
}

export interface LabourRateEntry {
  id: string
  role: string
  rate_per_day: number
  rate_per_hour?: number
  notes?: string
}

export interface AccommodationRateEntry {
  id: string
  region: string
  rate_per_day: number
  notes?: string
}

export interface PersonnelTransportRate {
  id: string
  region: string
  transport_mode: 'road' | 'air'
  rate_per_km?: number
  fixed_rate?: number
  notes?: string
}

export interface GeneratorTransportRate {
  id: string
  region: string
  description: string
  rate_per_km?: number
  fixed_rate?: number
  notes?: string
}

export interface SiteRateOverride {
  id: string
  site_code: string
  site_name: string
  multiplier?: number
  notes?: string
}

export interface RateSchedule {
  id: string
  org_id: string
  framework_id: string
  pricing_tier: 'A' | 'B' | 'C'
  effective_date: string
  expiry_date?: string
  is_active: boolean
  labour_rates: LabourRateEntry[]
  accommodation_rates: AccommodationRateEntry[]
  personnel_transport_rates: PersonnelTransportRate[]
  generator_transport_rates: GeneratorTransportRate[]
  site_overrides: SiteRateOverride[]
  notes?: string
  created_at: string
  updated_at: string
}

export interface PartsCatalogItem {
  id: string
  org_id: string
  part_name: string
  part_number?: string
  category?: string
  unit: string
  unit_cost?: number
  notes?: string
  created_at: string
  updated_at: string
}

export const KVA_RANGES: KvaRange[] = ['22-35', '40-55', '60-75', '80-110', '120-200', '250-330']

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  biannual_a: 'Biannual A (PPM-A)',
  biannual_b: 'Biannual B (PPM-B)',
  quarterly: 'Quarterly Check',
  corrective: 'Corrective Maintenance',
  emergency: 'Emergency Callout',
}

export const SLA_LEVEL_LABELS: Record<SlaLevel, string> = {
  exceptional: 'Exceptional / Very Good',
  very_good: 'Very Good',
  marginal: 'Marginal / Satisfactory',
  unsatisfactory: 'Unsatisfactory',
  defective: 'Defective Service',
}

export const SLA_LEVEL_COLORS: Record<SlaLevel, string> = {
  exceptional: 'bg-green-100 text-green-800',
  very_good: 'bg-emerald-100 text-emerald-800',
  marginal: 'bg-yellow-100 text-yellow-700',
  unsatisfactory: 'bg-orange-100 text-orange-800',
  defective: 'bg-red-100 text-red-800',
}
