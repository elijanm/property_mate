import client from './client'
import type { FeedbackRecord, ConfusionMatrix, AccuracyTrend, FeedbackSummary, OcrMetrics, DerivedMetricsResult } from '@/types/feedback'

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
  confusionMatrix: (trainerName: string, deploymentId?: string) =>
    client.get<ConfusionMatrix>(`/feedback/${trainerName}/confusion-matrix`, {
      params: deploymentId ? { deployment_id: deploymentId } : {},
    }).then(r => r.data),
  accuracyTrend: (trainerName: string, bucket: 'day' | 'hour' = 'day', deploymentId?: string) =>
    client.get<AccuracyTrend[]>(`/feedback/${trainerName}/accuracy-trend`, {
      params: { bucket, ...(deploymentId ? { deployment_id: deploymentId } : {}) },
    }).then(r => r.data),
  summary: (trainerName: string, deploymentId?: string) =>
    client.get<FeedbackSummary>(`/feedback/${trainerName}/summary`, {
      params: deploymentId ? { deployment_id: deploymentId } : {},
    }).then(r => r.data),

  ocrMetrics: (trainerName: string, deploymentId?: string) =>
    client.get<OcrMetrics>(`/feedback/${trainerName}/ocr-metrics`, {
      params: deploymentId ? { deployment_id: deploymentId } : {},
    }).then(r => r.data),

  derivedMetrics: (trainerName: string, deploymentIds: string[]) =>
    client.get<DerivedMetricsResult>(`/feedback/${trainerName}/derived-metrics`, {
      params: { deployment_ids: deploymentIds.join(',') },
    }).then(r => r.data),
}
