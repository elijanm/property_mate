export type WhatsAppStatus = 'disconnected' | 'connecting' | 'connected' | 'logged_out'

export interface WhatsAppInstance {
  id: string
  org_id: string
  property_id: string
  name: string
  status: WhatsAppStatus
  phone_number?: string
  push_name?: string
  qr_code?: string
  created_at: string
  updated_at: string
}

export interface WhatsAppEvent {
  id: string
  instance_id: string
  event_type: string
  payload: Record<string, unknown>
  media_url?: string
  media_content_type?: string
  received_at: string
}

/** WebSocket message pushed by the backend for whatsapp events */
export interface WhatsAppWsEvent {
  type: 'whatsapp_event' | 'whatsapp_status'
  instance_id: string
  event_type?: string
  status?: WhatsAppStatus
  qr_code?: string | null
  payload?: Record<string, unknown>
  received_at?: string
}
