export type FieldType = 'image' | 'file' | 'text' | 'number'
export type CaptureMode = 'camera_only' | 'upload_only' | 'both'
export type DescriptionMode = 'none' | 'free_text' | 'preset'
export type DatasetStatus = 'draft' | 'active' | 'closed'

export interface DatasetField {
  id: string
  label: string
  instruction: string
  type: FieldType
  capture_mode: CaptureMode
  required: boolean
  description_mode: DescriptionMode
  description_presets: string[]
  description_required: boolean
  order: number
  repeatable: boolean
  max_repeats: number  // 0 = unlimited
  // Model validation
  validation_model: string | null
  validation_labels: string[]
  validation_message: string
}

export type DatasetVisibility = 'private' | 'public'
export type ReferenceType = 'clone' | 'reference' | null

export interface DatasetProfile {
  id: string
  org_id: string
  name: string
  slug: string | null
  description: string
  category: string
  fields: DatasetField[]
  status: DatasetStatus
  // Visibility & sharing
  visibility: DatasetVisibility
  source_dataset_id: string | null
  reference_type: ReferenceType
  entry_count_cache: number
  points_enabled: boolean
  points_per_entry: number
  points_redemption_info: string
  created_by: string
  created_at: string
  updated_at: string
  collectors?: DatasetCollector[]
}

export interface DatasetCollector {
  id: string
  dataset_id: string
  email: string
  name: string
  token: string
  status: 'pending' | 'active' | 'completed'
  invited_at: string
  last_active_at: string | null
  entry_count: number
  points_earned: number
}

export interface DatasetEntry {
  id: string
  dataset_id: string
  collector_id: string
  field_id: string
  file_key: string | null
  file_url: string | null
  file_mime: string | null
  text_value: string | null
  description: string | null
  points_awarded: number
  captured_at: string
}

// Collect page types (public)
export interface CollectFormDefinition {
  dataset: {
    id: string
    name: string
    description: string
    category: string
    fields: DatasetField[]
    points_enabled: boolean
    points_per_entry: number
    points_redemption_info: string
  }
  collector: {
    id: string
    name: string
    email: string
    entry_count: number
    points_earned: number
  }
}

export interface DatasetCreatePayload {
  name: string
  slug?: string
  description: string
  category: string
  fields: Omit<DatasetField, 'id'>[]
  visibility?: DatasetVisibility
  points_enabled: boolean
  points_per_entry: number
  points_redemption_info: string
}
