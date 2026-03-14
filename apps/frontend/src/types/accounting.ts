export interface PropertyRevenue {
  property_id: string
  property_name: string
  invoiced: number
  collected: number
  outstanding: number
}

export interface AccountingSummary {
  total_invoiced: number
  total_collected: number
  total_outstanding: number
  collection_rate: number
  by_property: PropertyRevenue[]
  by_status: Record<string, number>
}

export interface TenantBehavior {
  tenant_id: string
  tenant_name: string
  avg_payment_delay_days: number
  on_time_rate: number
  outstanding_balance: number
  reliability_score: number
  total_invoices: number
  partial_payments: number
}

export interface TenantBehaviorList {
  items: TenantBehavior[]
  total: number
  next_cursor: string | null
  has_more: boolean
}

export interface VacantUnitDetail {
  property_id: string
  property_name: string
  unit_id: string
  unit_label: string
  days_vacant: number
  estimated_rent?: number
  estimated_lost_rent?: number
}

export interface VacancyReport {
  id: string
  org_id: string
  billing_month: string
  billing_cycle_run_id: string
  total_units: number
  occupied_units: number
  vacant_units: number
  vacancy_rate: number
  vacant_details: VacantUnitDetail[]
  estimated_lost_rent: number
}

export interface VacancyLive {
  total_units: number
  occupied_units: number
  vacant_units: number
  vacancy_rate: number
  estimated_lost_rent: number
  items: VacantUnitDetail[]
  next_cursor: string | null
  has_more: boolean
}
