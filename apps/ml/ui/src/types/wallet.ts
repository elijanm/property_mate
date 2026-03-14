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
