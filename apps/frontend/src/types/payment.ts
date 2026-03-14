export type PaymentCategory =
  | 'rent'
  | 'deposit'
  | 'utility_deposit'
  | 'utility'
  | 'late_fee'
  | 'termination_fee'
  | 'refund'

export type PaymentMethod =
  | 'manual'
  | 'cash'
  | 'bank_transfer'
  | 'mpesa_stk'
  | 'mpesa_b2c'

export type PaymentDirection = 'inbound' | 'outbound'

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled'

export interface Payment {
  id: string
  org_id: string
  lease_id: string
  property_id: string
  unit_id: string
  tenant_id: string
  category: PaymentCategory
  method: PaymentMethod
  direction: PaymentDirection
  amount: number
  currency: string
  status: PaymentStatus
  mpesa_checkout_request_id?: string
  mpesa_receipt_no?: string
  mpesa_phone?: string
  notes?: string
  recorded_by?: string
  payment_date: string
  created_at: string
  updated_at: string
}

export interface PaymentSummary {
  payments: Payment[]
  total_paid: number
  total_refunded: number
  balance: number
  deposit_paid: number
  deposit_required: number
  prorated_rent?: number
  prorated_days?: number
  days_in_month?: number
  fully_paid: boolean
  prepayment_credit: number
  outstanding_balance: number  // sum of balance_due across unpaid invoices
}

export interface LedgerEntry {
  id: string
  org_id: string
  lease_id: string
  property_id: string
  tenant_id: string
  payment_id?: string
  type: 'debit' | 'credit'
  category: string
  amount: number
  description: string
  running_balance: number
  created_at: string
}

export interface PaymentCreateRequest {
  category: PaymentCategory
  method: PaymentMethod
  amount: number
  payment_date: string
  mpesa_phone?: string
  notes?: string
}

export interface RefundRequest {
  method: PaymentMethod
  mpesa_phone?: string
  notes?: string
}
