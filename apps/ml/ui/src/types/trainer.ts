export interface TrainerRegistration {
  id: string
  name: string
  version: string
  description: string
  framework: string
  schedule: string | null
  tags: string[]
  status: 'active' | 'inactive'
  is_active: boolean
  last_trained_at: string | null
  created_at: string
  updated_at?: string
}

export interface ModelDeployment {
  id: string
  trainer_name: string
  version: string
  mlflow_model_name: string
  mlflow_model_version: string
  run_id: string | null
  model_uri: string
  source_type: string
  status: 'active' | 'inactive' | 'archived'
  is_default: boolean
  input_schema: Record<string, SchemaField>
  output_schema: Record<string, OutputSchemaField>
  metrics: Record<string, number>
  tags: Record<string, string>
  category: Record<string, string>  // { key: 'ocr', label: 'OCR & Vision' }
  visibility: 'viewer' | 'engineer'  // 'viewer' = all roles, 'engineer' = engineer/admin only
  created_at: string
}

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'image' | 'file'
  label?: string
  description?: string
  required?: boolean
  default?: unknown
  enum?: string[]
  format?: string
  // numeric hints
  min?: number
  max?: number
  step?: number
  unit?: string        // e.g. "cm", "kg"
  example?: unknown    // shown as hint text
}

export interface OutputSchemaField {
  type: 'text' | 'number' | 'image_url' | 'detections' | 'json' | 'boolean' | 'list'
  label: string
  editable?: boolean
  format?: 'percent' | 'decimal' | 'integer'
  description?: string
  example?: unknown    // sample output value shown before inference runs
}

export interface TrainingJob {
  id: string
  trainer_name: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger: string
  metrics: Record<string, number>
  error: string | null
  log_lines: string[]
  model_uri: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  compute_type: string          // 'local' | 'cloud_gpu'
  gpu_provider?: string | null
  gpu_type_id?: string | null
  remote_job_id?: string | null
  wallet_reserved: number       // USD reserved before job
  wallet_charged: number        // USD actually charged after completion
  gpu_price_per_hour?: number | null  // marked-up $/hr stored at reservation time
  pod_metrics?: {
    uptime_seconds?: number
    gpu_util_pct?: number
    gpu_mem_util_pct?: number
    cpu_pct?: number
    memory_pct?: number
  }
  cost_log?: Array<{
    ts: string
    elapsed_s: number
    accrued_usd: number
    gpu_util_pct?: number
    final?: boolean
  }>
}

export interface LocalGpuInfo {
  gpu_name: string
  vram_gb: number
  compute_capability: string | null
  is_cuda_available: boolean
  gpu_count: number
  is_free: boolean
  is_exempt: boolean
  global_free: boolean
  price_per_hour: number
  free_secs_remaining: number | null
}

export interface GpuOption {
  id: string
  name: string
  vram_gb: number
  price_per_hour: number    // USD, 40% markup applied
  price_usd: number
  base_price_usd: number
  currency: string          // 'USD'
  tier: 'budget' | 'standard' | 'performance' | 'enterprise'
  recommended: boolean
  available: boolean
}
