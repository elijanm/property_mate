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
  // Both variants must be deployments of the same trainer.
  trainer_name: string
  variant_a: string          // deployment id — the baseline
  variant_b: string          // deployment id — the challenger
  traffic_pct_b: number
  // Which metric keys to display in the comparison table.
  // Built-ins: 'accuracy', 'error_rate', 'latency'
  // Derived (trainer-declared): 'exact_match', 'digit_accuracy', 'edit_distance', 'numeric_delta', etc.
  metrics_to_use: string[]
  status: 'active' | 'paused' | 'concluded'
  winner: string | null      // 'a' | 'b' | null
  metrics_a: VariantMetrics
  metrics_b: VariantMetrics
  created_by: string
  created_at: string
  concluded_at: string | null
}

export interface CreateABTestPayload {
  name: string
  description?: string
  trainer_name: string
  variant_a: string
  variant_b: string
  traffic_pct_b: number
  metrics_to_use: string[]
}

function normalise(raw: unknown): ABTest {
  const t = raw as Record<string, unknown>
  return {
    ...(t as unknown as ABTest),
    // back-compat: old records stored model_a/model_b instead of variant_a/variant_b
    variant_a:      ((t['variant_a'] ?? t['model_a'] ?? '') as string),
    variant_b:      ((t['variant_b'] ?? t['model_b'] ?? '') as string),
    trainer_name:   ((t['trainer_name'] ?? '') as string),
    metrics_to_use: (t['metrics_to_use'] as string[] | undefined) ?? ['requests', 'error_rate', 'latency', 'accuracy'],
  }
}

export const abTestsApi = {
  list:   (status?: string) =>
    client.get<ABTest[]>('/ab-tests', { params: status ? { status } : {} }).then(r => r.data.map(normalise)),
  get:    (id: string) =>
    client.get<ABTest>(`/ab-tests/${id}`).then(r => r.data),
  create: (data: CreateABTestPayload) =>
    client.post<ABTest>('/ab-tests', data).then(r => r.data),
  update: (id: string, data: Partial<ABTest>) =>
    client.patch<ABTest>(`/ab-tests/${id}`, data).then(r => r.data),
  delete: (id: string) =>
    client.delete(`/ab-tests/${id}`),
}
