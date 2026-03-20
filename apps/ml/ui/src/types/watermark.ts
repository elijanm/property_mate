export interface OrgWatermarkConfig {
  id: string
  org_id: string
  has_watermark: boolean
  watermark_name: string
  watermark_url: string
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center'
  opacity: number       // 0.0–1.0
  scale: number         // 0.05–0.9
  active: boolean
  allow_user_override: boolean
  allowed_plans: string[]   // plan names that auto-grant override
  updated_at: string
}

export interface UserWatermarkConfig {
  id: string
  user_id: string
  org_id: string
  has_config: boolean
  has_watermark: boolean
  watermark_name: string
  watermark_url: string
  position: OrgWatermarkConfig['position'] | null
  opacity: number | null
  scale: number | null
  active: boolean
  granted_by: string | null
  granted_at: string | null
}
