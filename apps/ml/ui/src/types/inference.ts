export interface OutputFieldSpec {
  key: string
  type: 'image' | 'reading' | 'label' | 'confidence' | 'ranked_list' | 'bbox_list' | 'table_list' | 'text' | 'json'
  label: string
  primary: boolean
  hint: string
  span: number  // 1 = half-width, 2 = full-width
}

export interface InferenceLogSummary {
  id: string
  trainer_name: string
  deployment_id: string | null
  ab_test_variant: string | null   // "a" | "b" | null
  model_version: string | null
  outputs: Record<string, unknown> | null
  predicted_label_hint: string | null
  latency_ms: number | null
  created_at: string
}

export interface InferenceResult {
  result: unknown
  prediction?: unknown
  latency_ms?: number
  error?: string
  log_id?: string
}

export interface InferenceLog {
  id: string
  trainer_name: string
  model_version: string | null
  run_id: string | null
  inputs: unknown
  outputs: unknown
  corrected_output: unknown | null
  latency_ms: number | null
  error: string | null
  caller_org_id: string | null
  session_id: string | null
  created_at: string
}

export interface VersionComparison {
  deployment_id: string
  version: string
  model_name: string
  is_default: boolean
  result: unknown
  log_id: string | null
  error: string | null
  latency_ms: number | null
}

export interface CompareResponse {
  trainer_name: string
  comparisons: VersionComparison[]
}

export interface SSEEvent {
  type: 'inference' | 'feedback' | 'training' | 'ping' | 'connected'
  data: {
    trainer_name?: string
    model_version?: string
    latency_ms?: number
    has_error?: boolean
    error?: string
    [key: string]: unknown
  }
}
