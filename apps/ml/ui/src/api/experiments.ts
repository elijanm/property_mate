import client from './client'

export const experimentsApi = {
  list: () => client.get<{ id: string; name: string; lifecycle_stage: string }[]>('/experiments').then(r => r.data),
  listRuns: (experiment_id: string, limit = 50) =>
    client.get(`/experiments/${experiment_id}/runs`, { params: { limit } }).then(r => r.data),
  compare: (run_ids: string[]) =>
    client.post<{ runs: unknown[]; metric_keys: string[]; param_keys: string[] }>('/experiments/compare', { run_ids }).then(r => r.data),
  circuitBreakers: () => client.get<Record<string, { state: string; failures: number }>>('/experiments/circuit-breakers').then(r => r.data),
  resetCircuitBreaker: (trainer_name: string) =>
    client.delete(`/experiments/circuit-breakers/${trainer_name}`).then(r => r.data),
}

export const explainApi = {
  explain: (log_id: string) =>
    client.get<{ method: string; values: Record<string, number>; base_value?: number; note?: string }>(`/explain/${log_id}`).then(r => r.data),
}
