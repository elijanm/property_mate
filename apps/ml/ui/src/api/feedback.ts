import client from './client'
import type { FeedbackRecord, ConfusionMatrix, AccuracyTrend, FeedbackSummary } from '@/types/feedback'

export interface FeedbackPayload {
  trainer_name: string
  deployment_id?: string
  run_id?: string
  inference_log_id?: string
  model_output?: unknown
  predicted_label?: string
  actual_label?: string
  is_correct?: boolean
  confidence_reported?: number
  notes?: string
  session_id?: string
}

export const feedbackApi = {
  submit: (payload: FeedbackPayload) =>
    client.post('/feedback', payload).then(r => r.data),
  list: (trainerName: string, limit = 50) =>
    client.get<FeedbackRecord[]>(`/feedback/${trainerName}`, { params: { limit } }).then(r => r.data),
  confusionMatrix: (trainerName: string) =>
    client.get<ConfusionMatrix>(`/feedback/${trainerName}/confusion-matrix`).then(r => r.data),
  accuracyTrend: (trainerName: string, bucket: 'day' | 'hour' = 'day') =>
    client.get<AccuracyTrend[]>(`/feedback/${trainerName}/accuracy-trend`, { params: { bucket } }).then(r => r.data),
  summary: (trainerName: string) =>
    client.get<FeedbackSummary>(`/feedback/${trainerName}/summary`).then(r => r.data),
}
