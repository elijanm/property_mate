import client from './client'

export interface BatchJob {
  id: string
  trainer_name: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total_rows: number
  processed_rows: number
  failed_rows: number
  progress_pct: number
  submitted_by: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

export const batchApi = {
  submit: (trainer_name: string, rows: Record<string, unknown>[]) =>
    client.post<BatchJob>('/batch', { trainer_name, rows }).then(r => r.data),
  list: (trainer_name?: string) =>
    client.get<BatchJob[]>('/batch', { params: trainer_name ? { trainer_name } : {} }).then(r => r.data),
  get: (id: string) => client.get<BatchJob>(`/batch/${id}`).then(r => r.data),
  getResults: (id: string) =>
    client.get<{ job_id: string; total: number; results: { input: unknown; output: unknown; error: string | null }[] }>(
      `/batch/${id}/results`
    ).then(r => r.data),
}
