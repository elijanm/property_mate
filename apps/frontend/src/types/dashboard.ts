export interface OccupancyKpi {
  total_units: number
  occupied: number
  vacant: number
  occupancy_rate: number // 0-100
}

export interface FinancialKpi {
  outstanding_balance: number
  this_month_invoiced: number
  this_month_collected: number
  collection_rate_30d: number | null
}

export interface AlertCounts {
  open_tickets: number
  pending_meter_readings: number
  leases_expiring_30d: number
  overdue_invoices: number
}

export interface RecentPayment {
  id: string
  tenant_name: string
  amount: number
  method: string
  payment_date: string // ISO date
}

export interface RecentTicket {
  id: string
  title: string
  category: string
  status: string
  property_id: string
  created_at: string // ISO datetime
}

export interface CollectionTrendEntry {
  month: string // YYYY-MM
  invoiced: number
  collected: number
  rate: number | null
}

export interface DashboardData {
  occupancy: OccupancyKpi
  financial: FinancialKpi
  alerts: AlertCounts
  recent_payments: RecentPayment[]
  recent_tickets: RecentTicket[]
  collection_trend: CollectionTrendEntry[]
}
