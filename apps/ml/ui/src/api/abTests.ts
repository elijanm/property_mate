import client from './client'

export interface VariantMetrics {
  requests: number
  error_rate: number
  avg_latency_ms: number
  accuracy: number | null
}

export interface ABTest {
  id: string
  name: string
  description: string
  model_a: string
  model_b: string
  traffic_pct_b: number
  status: 'active' | 'paused' | 'concluded'
  winner: string | null
  metrics_a: VariantMetrics
  metrics_b: VariantMetrics
  created_by: string
  created_at: string
  concluded_at: string | null
}

export const abTestsApi = {
  list: (status?: string) => client.get<ABTest[]>('/ab-tests', { params: status ? { status } : {} }).then(r => r.data),
  get: (id: string) => client.get<ABTest>(`/ab-tests/${id}`).then(r => r.data),
  create: (data: { name: string; model_a: string; model_b: string; traffic_pct_b: number; description?: string }) =>
    client.post<ABTest>('/ab-tests', data).then(r => r.data),
  update: (id: string, data: Partial<ABTest>) => client.patch<ABTest>(`/ab-tests/${id}`, data).then(r => r.data),
  delete: (id: string) => client.delete(`/ab-tests/${id}`),
}
