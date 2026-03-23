export type FieldType = 'image' | 'video' | 'media' | 'file' | 'text' | 'number' | 'select'
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

export interface UrlDatasetInfo {
  id: string
  source_url: string
  status: 'pending' | 'fetching' | 'ready' | 'error'
  item_count: number | null
  size_bytes: number | null
  last_fetched_at: string | null
  next_fetch_at: string | null
  fetch_error: string | null
  refresh_interval_hours: number
  content_type: string
}

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
  discoverable: boolean
  contributor_allowlist: string[]
  points_enabled: boolean
  points_per_entry: number
  points_redemption_info: string
  // Location tracking
  require_location: boolean
  location_purpose: string
  // Consent
  require_consent: boolean
  consent_template_id: string | null
  consent_type: 'individual' | 'group'
  created_by: string
  created_at: string
  updated_at: string
  collectors?: DatasetCollector[]
  url_dataset?: UrlDatasetInfo
}

export interface DatasetCollector {
  id: string
  dataset_id: string
  email: string
  phone: string | null
  name: string
  token: string
  status: 'pending' | 'active' | 'completed'
  invited_at: string
  last_active_at: string | null
  entry_count: number
  points_earned: number
}

export type QualityIssue = 'blurry' | 'dark' | 'overexposed' | 'low_res'

export interface EntryLocation {
  lat: number | null
  lng: number | null
  accuracy: number | null
  source: 'gps' | 'ip'
  ip_address: string | null
  country: string | null
  country_name: string | null
  city: string | null
  timezone: string | null
  isp: string | null
}

export interface DatasetEntry {
  id: string
  dataset_id: string
  collector_id: string
  field_id: string
  file_key: string | null
  file_url: string | null
  file_mime: string | null
  file_size_bytes: number | null
  text_value: string | null
  description: string | null
  points_awarded: number
  location: EntryLocation | null
  captured_at: string
  review_status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  // quality metrics
  blur_score: number | null
  brightness: number | null
  quality_score: number | null
  quality_issues: QualityIssue[]
  phash: string | null
  file_hash: string | null
  archived: boolean
  consent_record_id?: string | null
}

export interface SimilarDatasetEntry extends DatasetEntry {
  similarity_distance: number
  similarity_pct: number
}

export interface DatasetEntryListResponse {
  items: DatasetEntry[]
  total: number
  page: number
  page_size: number
  total_pages: number
  archived_count: number
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
    require_location: boolean
    location_purpose: string
    require_consent: boolean
    consent_type: 'individual' | 'group'
    consent_template_id: string | null
  }
  collector: {
    id: string
    name: string
    email: string
    entry_count: number
    points_earned: number
  }
}

// Dataset overview / analytics
export interface DatasetOverview {
  dataset_id: string
  name: string
  status: string
  require_location: boolean
  summary: {
    total_entries: number
    total_collectors: number
    total_points_awarded: number
    active_collectors: number
  }
  location: {
    gps_count: number
    ip_count: number
    no_location: number
    gps_pct: number
    countries: { code: string; count: number }[]
    cities: { name: string; count: number }[]
    gps_points: { lat: number; lng: number }[]
  }
  daily_trend: { date: string; count: number }[]
  top_collectors: { name: string; email: string; entries: number; points: number }[]
  field_breakdown: { field_id: string; label: string; count: number }[]
  quality: {
    scored: number
    no_score: number
    good: number
    poor: number
    avg_score: number | null
    good_pct: number
    issues: { label: string; count: number }[]
  }
}

export interface DatasetCreatePayload {
  name: string
  slug?: string
  description: string
  category: string
  fields: Omit<DatasetField, 'id'>[]
  visibility?: DatasetVisibility
  discoverable?: boolean
  contributor_allowlist?: string[]
  points_enabled: boolean
  points_per_entry: number
  points_redemption_info: string
  require_location?: boolean
  location_purpose?: string
  require_consent?: boolean
  consent_template_id?: string
  consent_type?: string
}
