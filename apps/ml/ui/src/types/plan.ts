export interface MLPricingConfig {
  local_cpu_price_per_hour: number  // CPU-only training rate
  local_cpu_free: boolean           // admin override: CPU training free for ALL
  local_gpu_price_per_hour: number
  local_gpu_free: boolean           // admin override: free for ALL users
  inference_price_per_call: number
  inference_free: boolean           // admin override: inference free for ALL users
  updated_at: string | null
}

export interface MLPlan {
  id: string
  name: string
  description: string
  price_usd_per_month: number
  included_period: 'day' | 'week' | 'month' | 'none'
  included_cpu_hours: number
  included_local_gpu_hours: number
  included_cloud_gpu_credit_usd: number
  free_inference_calls: number
  free_inference_period: 'day' | 'week' | 'month' | 'none'
  new_customer_credit_usd: number
  is_active: boolean
  is_default: boolean
  created_at: string | null
  updated_at: string | null
  // computed server-side for public pricing endpoint
  included_compute_value_usd?: number
  // legacy (kept for compat)
  free_training_hours?: number
  free_training_period?: string
  free_local_gpu_hours?: number
}

export interface MLUserPlan {
  id: string
  user_email: string
  org_id: string
  plan_id: string
  plan_name: string
  local_gpu_exempt: boolean         // admin-set: user never charged for local GPU
  free_training_used_seconds: number
  free_training_used_hours: number
  free_training_period_reset_at: string | null
  free_inference_used: number
  free_inference_period_reset_at: string | null
  new_customer_credit_given: boolean
  new_customer_credit_amount: number
  assigned_at: string | null
}

export interface UserPlanInfo {
  user_email: string
  plan: MLPlan | null
  usage?: MLUserPlan
  pricing?: MLPricingConfig
}

export type PlanPeriod = 'day' | 'week' | 'month' | 'none'

export const PERIOD_LABELS: Record<PlanPeriod, string> = {
  day: 'per day',
  week: 'per week',
  month: 'per month',
  none: 'lifetime',
}
