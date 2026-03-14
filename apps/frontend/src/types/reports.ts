// ── Meter Readings ────────────────────────────────────────────────────────────

export type MeterReadingStatus = 'confirmed' | 'pending'

export interface MeterPricingTier {
  from_units: number
  to_units: number | null
  rate: number
}

export interface MeterReadingRow {
  invoice_id: string
  invoice_reference: string
  line_item_id: string
  unit_id: string
  unit_code: string
  wing: string
  floor: number
  unit_type: string
  meter_number: string
  utility_key: string
  billing_month: string
  previous_reading: number | null
  current_reading: number | null
  consumption: number
  unit_price: number
  amount: number
  is_tiered: boolean
  tiers: MeterPricingTier[] | null
  effective_rate: number
  status: MeterReadingStatus
  has_photo: boolean
  meter_ticket_id: string | null
}

export interface MeterLiveCacheEntry {
  unit_id: string
  unit_code: string
  wing: string
  floor: number
  unit_type: string
  meter_number: string
  utility_key: string
  current_reading: number
  read_at: string
  read_by_name: string
}

export interface MeterReadingsByUtility {
  confirmed: number
  pending: number
  total_consumption: number
}

export interface MeterReadingsData {
  property_id: string
  property_name: string
  generated_at: string
  billing_months: string[]
  summary: {
    total_readings: number
    confirmed: number
    pending: number
    pending_units: number
    by_utility: Record<string, MeterReadingsByUtility>
  }
  rows: MeterReadingRow[]
  live_cache: MeterLiveCacheEntry[]
}

// ── Utility Consumption ───────────────────────────────────────────────────────

export interface UtilityPeriodReading {
  billing_month: string
  consumption: number
  current_reading: number | null
  previous_reading: number | null
  unit_price: number
  amount: number
  is_tiered: boolean
  tiers: MeterPricingTier[] | null
  effective_rate: number
}

export interface UtilityConsumptionRow {
  unit_id: string
  unit_code: string
  wing: string
  floor: number
  unit_type: string
  utility_key: string
  total_consumption: number
  total_amount: number
  num_periods: number
  avg_monthly_consumption: number
  last_reading: number | null
  first_month: string | null
  last_month: string | null
  is_tiered: boolean
  effective_rate: number
  periods: UtilityPeriodReading[]
}

export interface UtilityBreakdown {
  utility_key: string
  total_consumption: number
  total_amount: number
  unit_count: number
  readings: number
}

export interface UtilityPeriodEntry {
  billing_month: string
  utilities: Record<string, { consumption: number; amount: number; readings: number }>
}

export interface UtilitySummaryByKey {
  total_consumption: number
  total_amount: number
  unit_count: number
}

export interface UtilityConsumptionData {
  property_id: string
  property_name: string
  generated_at: string
  utility_keys: string[]
  summary: {
    total_readings: number
    metered_unit_count: number
    period_count: number
    by_utility: Record<string, UtilitySummaryByKey>
  }
  by_period: UtilityPeriodEntry[]
  by_utility: UtilityBreakdown[]
  rows: UtilityConsumptionRow[]
}

// ── Vacancy Detail ────────────────────────────────────────────────────────────

export interface VacancyDetailRow {
  unit_id: string
  unit_code: string
  wing: string
  floor: number
  unit_type: string
  size: number | null
  status: 'vacant' | 'inactive'
  days_vacant: number
  last_rent: number | null
  estimated_loss: number | null
  last_tenant_name: string | null
  last_tenant_phone: string | null
  last_tenant_email: string | null
  last_lease_end: string | null
  ever_leased: boolean
}

export interface VacancyDetailSummary {
  total_vacant: number
  total_inactive: number
  never_leased: number
  avg_days_vacant: number | null
  total_estimated_loss: number
}

export interface VacancyDetailData {
  property_id: string
  property_name: string
  generated_at: string
  summary: VacancyDetailSummary
  rows: VacancyDetailRow[]
}

// ── Occupancy ─────────────────────────────────────────────────────────────────

export interface OccupancyUnitRow {
  unit_id: string
  unit_code: string
  wing: string
  floor: number
  unit_type: string
  size: number | null
  status: string
  tenant_name: string | null
  monthly_rent: number | null
  lease_end: string | null
}

export interface OccupancyBreakdownRow {
  total: number
  occupied: number
  vacant: number
  occupancy_rate: number | null
}

export interface OccupancyWingRow extends OccupancyBreakdownRow {
  wing: string
}

export interface OccupancyFloorRow extends OccupancyBreakdownRow {
  floor: number
}

export interface OccupancyTypeRow extends OccupancyBreakdownRow {
  unit_type: string
}

export interface OccupancySummary {
  total_units: number
  occupied: number
  vacant: number
  occupancy_rate: number | null
}

export interface OccupancyData {
  property_id: string
  property_name: string
  generated_at: string
  summary: OccupancySummary
  by_wing: OccupancyWingRow[]
  by_floor: OccupancyFloorRow[]
  by_type: OccupancyTypeRow[]
  rows: OccupancyUnitRow[]
}

// ── Payment Behavior ──────────────────────────────────────────────────────────

export interface PaymentBehaviorRow {
  tenant_id: string
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  unit_id: string | null
  unit_code: string
  total_invoices: number
  paid_count: number
  partial_count: number
  unpaid_count: number
  on_time_count: number
  avg_payment_delay_days: number | null
  on_time_rate: number | null
  reliability_score: number | null
  last_payment_date: string | null
  outstanding_balance: number
}

export interface PaymentBehaviorSummary {
  tenant_count: number
  avg_reliability_score: number | null
  avg_on_time_rate: number | null
  avg_payment_delay_days: number | null
  excellent_count: number
  good_count: number
  poor_count: number
}

export interface PaymentBehaviorData {
  property_id: string
  property_name: string
  generated_at: string
  summary: PaymentBehaviorSummary
  rows: PaymentBehaviorRow[]
}

// ── Lease Expiry ──────────────────────────────────────────────────────────────

export type LeaseUrgency = 'critical' | 'warning' | 'notice'

export interface LeaseExpiryRow {
  lease_id: string
  tenant_id: string | null
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  unit_id: string | null
  unit_code: string
  unit_type: string | null
  lease_start: string | null
  lease_end: string
  days_remaining: number
  urgency: LeaseUrgency
  monthly_rent: number
  deposit_amount: number
}

export interface LeaseExpirySummary {
  total: number
  critical: number
  warning: number
  notice: number
  total_rent_at_risk: number
}

export interface LeaseExpiryData {
  property_id: string
  property_name: string
  generated_at: string
  window_days: number
  summary: LeaseExpirySummary
  rows: LeaseExpiryRow[]
}

// ── Outstanding Balances ──────────────────────────────────────────────────────

export interface OutstandingBalancesRow {
  tenant_id: string
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  unit_id: string | null
  unit_code: string
  invoice_count: number
  overdue_invoice_count: number
  oldest_billing_month: string
  oldest_due_date: string | null
  max_days_overdue: number
  total_invoiced: number
  total_paid: number
  total_balance: number
  last_payment_date: string | null
}

export interface OutstandingBalancesSummary {
  total_outstanding: number
  tenant_count: number
  invoice_count: number
  never_paid_count: number
  avg_days_overdue: number
}

export interface OutstandingBalancesData {
  property_id: string
  property_name: string
  generated_at: string
  summary: OutstandingBalancesSummary
  rows: OutstandingBalancesRow[]
}

// ── Collection Rate ───────────────────────────────────────────────────────────

export interface CollectionRateRow {
  billing_month: string
  invoice_count: number
  total_invoiced: number
  total_collected: number
  total_outstanding: number
  paid_count: number
  on_time_count: number
  late_count: number
  partial_count: number
  unpaid_count: number
  collection_rate: number | null
  on_time_rate: number | null
}

export interface CollectionRateSummary {
  total_invoiced: number
  total_collected: number
  total_outstanding: number
  total_invoices: number
  paid_invoices: number
  collection_rate: number | null
  on_time_rate: number | null
}

export interface CollectionRateData {
  property_id: string
  property_name: string
  generated_at: string
  period_months: number
  summary: CollectionRateSummary
  rows: CollectionRateRow[]
}

// ── Arrears ───────────────────────────────────────────────────────────────────

export type ArrearsBucket = '0_30' | '31_60' | '61_90' | '90_plus'

export interface ArrearsRow {
  invoice_id: string
  reference_no: string
  tenant_id: string | null
  tenant_name: string
  tenant_email: string | null
  tenant_phone: string | null
  unit_id: string | null
  unit_code: string
  billing_month: string
  due_date: string | null
  days_overdue: number
  bucket: ArrearsBucket
  total_amount: number
  amount_paid: number
  balance_due: number
  status: string
}

export interface ArrearsBucketSummary {
  count: number
  balance: number
}

export interface ArrearsSummary {
  total_overdue_balance: number
  total_invoices: number
  bucket_0_30: ArrearsBucketSummary
  bucket_31_60: ArrearsBucketSummary
  bucket_61_90: ArrearsBucketSummary
  bucket_90_plus: ArrearsBucketSummary
}

export interface ArrearsData {
  property_id: string
  property_name: string
  generated_at: string
  summary: ArrearsSummary
  rows: ArrearsRow[]
}

// ── Rent Roll ─────────────────────────────────────────────────────────────────

export type RentRollHealth = 'healthy' | 'overdue' | 'expiring_soon' | 'vacant'

export interface RentRollRow {
  unit_id: string
  unit_code: string
  wing: string
  floor: number | null
  unit_type: string
  size: number | null
  status: 'occupied' | 'vacant'
  tenant_name: string | null
  tenant_email: string | null
  tenant_phone: string | null
  lease_id: string | null
  lease_status: string | null
  lease_start: string | null
  lease_end: string | null
  days_remaining: number | null
  monthly_rent: number | null
  deposit_held: number
  utility_deposit: number
  balance_due: number
  health: RentRollHealth
}

export interface RentRollSummary {
  total_units: number
  occupied: number
  vacant: number
  occupancy_rate: number
  total_monthly_rent: number
  total_balance_due: number
  total_deposit_held: number
}

export interface RentRollData {
  property_id: string
  property_name: string
  generated_at: string
  summary: RentRollSummary
  rows: RentRollRow[]
}
