import client from './client'
import type { MLPricingConfig, MLPlan, MLUserPlan, UserPlanInfo } from '../types/plan'

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
}
