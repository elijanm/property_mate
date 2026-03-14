export interface Wallet {
  id: string
  user_email: string
  balance: number
  reserved: number
  currency: string
  local_quota_seconds: number
  local_used_seconds: number
  local_quota_reset_at: string | null
  created_at: string
  updated_at: string
}

export interface WalletTransaction {
  id: string
  type: 'credit' | 'debit' | 'reserve' | 'release'
  amount: number
  balance_after: number
  reserved_after: number
  description: string
  reference: string | null
  job_id: string | null
  created_at: string
}

export interface PlatformLedgerEntry {
  id: string
  amount_usd: number
  recipient_email: string
  performed_by: string
  note: string
  wallet_tx_id: string
  created_at: string
}

export interface AdminLedgerResponse {
  items: PlatformLedgerEntry[]
  total: number
  total_spent_usd: number
  page: number
  page_size: number
}

export interface AdminUserSummary {
  email: string
  full_name: string
  org_id: string
  role: string
}

export interface LocalQuota {
  quota_seconds: number
  used_seconds: number
  remaining_seconds: number
  quota_hours: number
  used_hours: number
  remaining_hours: number
  reset_at: string | null
  exhausted: boolean
}
