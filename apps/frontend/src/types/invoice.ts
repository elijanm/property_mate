export type InvoiceStatus =
  | 'draft'
  | 'ready'
  | 'sent'
  | 'partial_paid'
  | 'paid'
  | 'overdue'
  | 'void'

export type InvoiceLineType =
  | 'rent'
  | 'deposit'
  | 'utility_deposit'
  | 'subscription_utility'
  | 'metered_utility'
  | 'credit'
  | 'adjustment'
  | 'carried_forward'

export type LineItemStatus = 'confirmed' | 'pending'

export interface TierBand {
  band: string
  units: number
  rate: number
  subtotal: number
}

export interface InvoiceLineItem {
  id: string
  type: InvoiceLineType
  description: string
  utility_key?: string
  quantity: number
  unit_price: number
  amount: number
  meter_ticket_id?: string
  current_reading?: number
  previous_reading?: number
  meter_image_url?: string
  status: LineItemStatus
  tier_breakdown?: TierBand[]  // computed band-by-band breakdown (confirmed metered only)
}

export interface SmartMeterDailyReading {
  date: string
  readings: number
  total_usage: number
  avg_usage: number
}

export interface SmartMeterSummary {
  unit_id: string
  utility_key: string
  reading_count: number
  total_usage: number        // total L consumed
  avg_daily_usage: number    // avg L/day
  peak_day: string
  peak_usage: number
  trend_pct: number
  trend_direction: 'up' | 'down' | 'stable'
  advice: string[]
  daily_breakdown: SmartMeterDailyReading[]
  latest_reading: number
  previous_reading: number
  applied_at: string
}

export interface Invoice {
  id: string
  org_id: string
  property_id: string
  unit_id: string
  lease_id: string
  tenant_id: string
  idempotency_key: string
  billing_month: string
  invoice_category: 'rent' | 'deposit'
  status: InvoiceStatus
  sandbox: boolean
  reference_no: string
  due_date: string
  line_items: InvoiceLineItem[]
  subtotal: number
  tax_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  carried_forward: number
  notes?: string
  sent_at?: string
  paid_at?: string
  created_by?: string
  created_at: string
  updated_at: string
  smart_meter_summary?: SmartMeterSummary
  // Enriched
  tenant_name?: string
  property_name?: string
  unit_label?: string
}

export interface InvoiceListResponse {
  items: Invoice[]
  total: number
  page: number
  page_size: number
}

export interface InvoiceCounts {
  draft: number
  ready: number
  sent: number
  partial_paid: number
  paid: number
  overdue: number
  void: number
  total: number
}

export interface BillingCycleRun {
  id: string
  org_id: string
  billing_month: string
  run_type: string
  sandbox: boolean
  triggered_by?: string
  status: string
  invoices_created: number
  invoices_skipped: number
  invoices_failed: number
  dry_run_preview?: Record<string, unknown>[]
  failures: Record<string, unknown>[]
  started_at: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface BillingRunListResponse {
  items: BillingCycleRun[]
  total: number
  page: number
  page_size: number
}

export interface InvoiceGeneratePayload {
  billing_month: string
  sandbox: boolean
  dry_run: boolean
}

/** Returned by POST /invoices/generate when dry_run=false (async path). */
export interface BillingRunTriggerResponse {
  job_id: string
  status: 'queued'
  billing_month: string
}

export type GenerateBillingResponse = BillingCycleRun | BillingRunTriggerResponse

/** True when the generate response is an async queued trigger (not a dry-run result). */
export function isBillingRunQueued(r: GenerateBillingResponse): r is BillingRunTriggerResponse {
  return 'job_id' in r && !('invoices_created' in r)
}

export interface InvoiceUpdatePayload {
  status?: InvoiceStatus
  notes?: string
  due_date?: string
}

export interface InvoicePaymentPayload {
  amount: number
  method: string
  payment_date: string
  reference?: string
  notes?: string
}
