import apiClient from '@/api/client'

export interface JobRun {
  id: string
  job_type: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'retrying'
  org_id?: string
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  attempts: number
  created_at: string
  updated_at: string
  completed_at?: string
}

export const jobsApi = {
  get: (jobId: string): Promise<JobRun> =>
    apiClient.get(`/jobs/${jobId}`).then((r) => r.data),
}
