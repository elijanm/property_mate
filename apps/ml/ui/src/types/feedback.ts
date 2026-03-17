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

export interface OcrMetrics {
  total: number
  exact_match: number
  exact_match_rate: number       // 0-1
  char_error_rate: number        // avg Levenshtein / actual length
  digit_accuracy: number         // % of digit positions correct
  off_by: {
    exact: number
    '1': number
    '2_to_10': number
    '11_to_100': number
    over_100: number
  }
  common_errors: { actual: string; predicted: string; count: number }[]
}

export interface ConfusionMatrix {
  mode?: 'classifier' | 'ocr'
  // classifier fields
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
  // OCR fields (present when mode === 'ocr')
  exact_match?: number
  exact_match_rate?: number
  char_error_rate?: number
  digit_accuracy?: number
  off_by?: OcrMetrics['off_by']
  common_errors?: OcrMetrics['common_errors']
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

export interface DerivedMetricSpec {
  key: string
  label: string
  description: string
  unit: string
  higher_is_better: boolean
  category: string
}

export interface DerivedMetricsResult {
  specs: DerivedMetricSpec[]
  per_deployment: Record<string, Record<string, number | null>>
}
