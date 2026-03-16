export interface AnnotatorProfile {
  email: string
  full_name: string
  phone_number: string | null
  country: string
  county: string
  bio: string
  total_points_earned: number
  total_points_redeemed: number
  redeemable_points: number
  total_entries_submitted: number
  total_tasks_completed: number
  referral_code: string
  joined_at: string
  last_active_at: string | null
  // KYC
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected'
  avatar_key: string | null
  id_front_key: string | null
  id_back_key: string | null
  kyc_submitted_at: string | null
  kyc_rejection_reason: string | null
}

export interface AnnotatorStats {
  total_entries: number
  total_points: number
  redeemable_points: number
  total_tasks: number
  tasks_completed: number
  kes_value: number          // legacy: local amount
  local_amount: number
  local_currency: string
  local_formatted: string
  rank: number | null
}

export interface AnnotatorTask {
  dataset_id: string
  name: string
  description: string
  category: string
  points_enabled: boolean
  points_per_entry: number
  points_redemption_info: string
  require_location?: boolean
  field_count?: number
  entry_count: number
  total_entries: number
  joined: boolean
  token: string | null
  is_repeatable?: boolean
  is_done?: boolean
  required_fields_count?: number
  status?: string
}

export interface RewardSummary {
  total_earned: number
  total_redeemed: number
  redeemable: number
  kes_value: number         // legacy
  local_amount: number
  local_currency: string
  local_formatted: string
  rate_label: string
  min_redemption_points: number
  can_redeem: boolean
  kyc_required: boolean
  kyc_status: string
}

export interface RewardRedemption {
  id: string
  points_redeemed: number
  kes_value: number
  phone_number: string
  status: 'pending' | 'sent' | 'failed'
  created_at: string
}

export interface PlatformRewardRate {
  point_value_usd: number
  currency: string
  one_point_value: string
  hundred_points_value: string
  rate_label: string
  exchange_rates: Record<string, number>
  min_redemption_points: number
  withdrawal_kyc_threshold_usd: number
}
