import client from './client'

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
}
