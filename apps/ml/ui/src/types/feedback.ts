export interface FeedbackRecord {
  id: string
  trainer_name: string
  predicted_label: string | null
  actual_label: string | null
  is_correct: boolean | null
  confidence_reported: number | null
  notes: string | null
  created_at: string
}

export interface ConfusionMatrix {
  labels: string[]
  matrix: number[][]
  accuracy: number
  total: number
  correct: number
  per_label: Record<string, {
    precision: number
    recall: number
    f1: number
    support: number
  }>
}

export interface AccuracyTrend {
  timestamp: string
  total: number
  correct: number
  accuracy: number
}

export interface FeedbackSummary {
  total_feedback: number
  correct: number
  incorrect: number
  accuracy: number | null
}
