import axios from 'axios'
import client from './client'
import type { MLPricingConfig, MLPlan, MLUserPlan, UserPlanInfo } from '../types/plan'

// Unauthenticated client for public endpoints
const publicClient = axios.create({ baseURL: client.defaults.baseURL ?? '/api/v1' })

export interface AnalyticsData {
  period: { from: string | null; to: string | null }
  users: {
    total: number
    active: number
    verified: number
    by_role: { admin: number; engineer: number; viewer: number }
  }
  training: {
    total_jobs: number
    running: number
    queued: number
    completed: number
    failed: number
    local_jobs: number
    cloud_jobs: number
    gpu_hours_estimate: number
    local_hours_purchased: number
  }
  revenue: {
    total_topups_usd: number
    gpu_charges_usd: number
    gpu_revenue_usd: number
  }
  models: { total: number; active: number }
  inference: {
    total: number
    errors: number
    error_rate_pct: number
    avg_latency_ms: number
  }
  top_trainers: { name: string; jobs: number }[]
}

export interface BroadcastPayload {
  subject: string
  html: string
  recipient_filter: 'all' | 'active' | 'verified' | 'engineers'
  preview_to?: string
  raw?: boolean
}

export interface BroadcastResult {
  sent: number
  skipped: number
  preview: boolean
}

export interface UserUsageMetric {
  used_hours?: number
  limit_hours?: number
  pct: number
  period?: string
  reset_at: string | null
}

export interface UserUsageRow {
  email: string
  full_name: string
  role: string
  org_id: string
  plan_name: string | null
  local_compute: UserUsageMetric & { used_hours: number; limit_hours: number }
  cloud_gpu: { used_usd: number; limit_usd: number; pct: number; reset_at: string | null }
  inference: {
    quota_used: number
    quota_limit: number
    quota_pct: number
    period: string
    reset_at: string | null
    month_total: number
    month_cost_usd: number
    avg_latency_ms: number | null
    p95_latency_ms: number | null
    last_called_at: string | null
  }
  storage: {
    model_count: number
    dataset_count: number
    storage_bytes: number
  }
}

export interface UsageResponse {
  users: UserUsageRow[]
  total: number
  month_start: string
}

export const adminApi = {
  getAnalytics: (from?: string, to?: string) => {
    const params: Record<string, string> = {}
    if (from) params['from'] = from
    if (to) params['to'] = to
    return client.get<AnalyticsData>('/admin/analytics', { params }).then(r => r.data)
  },

  broadcast: (payload: BroadcastPayload) =>
    client.post<BroadcastResult>('/admin/broadcast', payload).then(r => r.data),

  // ── Pricing ───────────────────────────────────────────────────────────────
  getPricing: () =>
    client.get<MLPricingConfig>('/admin/pricing').then(r => r.data),

  updatePricing: (data: Partial<MLPricingConfig>) =>
    client.put<MLPricingConfig>('/admin/pricing', data).then(r => r.data),

  // ── Plans ─────────────────────────────────────────────────────────────────
  getPlans: (includeInactive = false) =>
    client.get<{ plans: MLPlan[] }>('/admin/plans', { params: { include_inactive: includeInactive } })
      .then(r => r.data.plans),

  createPlan: (data: Omit<MLPlan, 'id' | 'created_at' | 'updated_at'>) =>
    client.post<MLPlan>('/admin/plans', data).then(r => r.data),

  updatePlan: (planId: string, data: Partial<MLPlan>) =>
    client.put<MLPlan>(`/admin/plans/${planId}`, data).then(r => r.data),

  deletePlan: (planId: string) =>
    client.delete<{ deactivated: boolean }>(`/admin/plans/${planId}`).then(r => r.data),

  seedPlans: () =>
    client.post<{ created: string[]; skipped: string[] }>('/admin/plans/seed').then(r => r.data),

  getPublicPricing: () =>
    publicClient.get<{
      pricing: Pick<MLPricingConfig, 'local_cpu_price_per_hour' | 'local_gpu_price_per_hour' | 'inference_price_per_call'> & { cloud_gpu_min_price_per_hour: number }
      plans: (MLPlan & { included_compute_value_usd: number })[]
    }>('/admin/public/pricing').then(r => r.data),

  // ── User plan ─────────────────────────────────────────────────────────────
  assignPlan: (planId: string, userEmail: string, orgId = '') =>
    client.post(`/admin/plans/${planId}/assign`, { user_email: userEmail, org_id: orgId }).then(r => r.data),

  getUserPlan: (userEmail: string, orgId = '') =>
    client.get<UserPlanInfo>(`/admin/users/${encodeURIComponent(userEmail)}/plan`, { params: { org_id: orgId } })
      .then(r => r.data),

  setUserExempt: (userEmail: string, orgId: string, localGpuExempt: boolean) =>
    client.patch<MLUserPlan>(`/admin/users/${encodeURIComponent(userEmail)}/exempt`, {
      org_id: orgId,
      local_gpu_exempt: localGpuExempt,
    }).then(r => r.data),

  // ── Usage tracker ─────────────────────────────────────────────────────────
  getUsage: () =>
    client.get<UsageResponse>('/admin/usage').then(r => r.data),

  getMyUsage: () =>
    client.get<UserUsageRow & { month_start: string }>('/admin/usage/me').then(r => r.data),
}
