export type CCTVCameraStatus = 'online' | 'offline' | 'unknown'

export type CCTVEventType =
  | 'motion'
  | 'person'
  | 'vehicle'
  | 'suspicious'
  | 'intrusion'
  | 'loitering'
  | 'fire'

export interface CCTVCamera {
  id: string
  org_id: string
  property_id: string
  name: string
  location?: string
  description?: string
  onvif_host?: string
  onvif_port: number
  onvif_username?: string
  rtsp_url?: string
  hls_url?: string
  snapshot_url?: string
  is_sandbox: boolean
  sandbox_youtube_id?: string
  status: CCTVCameraStatus
  last_seen_at?: string
  created_at: string
  updated_at: string
}

export interface CCTVCameraPayload {
  name: string
  location?: string
  description?: string
  onvif_host?: string
  onvif_port?: number
  onvif_username?: string
  onvif_password?: string
  rtsp_url?: string
  hls_url?: string
  snapshot_url?: string
  is_sandbox?: boolean
  sandbox_youtube_id?: string
}

export interface CCTVEvent {
  id: string
  org_id: string
  property_id: string
  camera_id: string
  event_type: CCTVEventType
  is_suspicious: boolean
  confidence: number
  occurred_at: string
  thumbnail_url?: string
  clip_url?: string
  description?: string
  tags: string[]
  clip_offset_seconds: number
  is_reviewed: boolean
  reviewed_by?: string
  reviewed_at?: string
  review_notes?: string
  created_at: string
}
