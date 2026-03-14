export interface AttachmentFile {
  id: string
  s3_key: string
  filename: string
  size_bytes: number
  mime_type: string
  url?: string
  uploaded_at: string
}

// ── Legacy MaintenanceTicket (meter discrepancy from inspection flow) ──────────

export type LegacyTicketStatus = 'open' | 'resolved'

export interface MaintenanceTicket {
  id: string
  org_id: string
  property_id: string
  unit_id: string
  lease_id: string
  inspection_report_id: string
  ticket_type: string
  title: string
  description: string
  utility_key: string
  utility_label: string
  system_reading: number | null
  reported_reading: number
  status: LegacyTicketStatus
  assigned_to: string | null
  resolution_reading: number | null
  resolution_notes: string | null
  evidence_urls: string[]
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

// ── New comprehensive Ticket ──────────────────────────────────────────────────

export type TicketStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'pending_review'
  | 'resolved'
  | 'closed'
  | 'cancelled'

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TicketCategory =
  | 'maintenance'
  | 'utility_reading'
  | 'move_in_inspection'
  | 'move_out_request'
  | 'move_out_inspection'
  | 'move_out_refund'
  | 'request'
  | 'complaint'
  | 'other'

export type TicketTaskType = 'meter_reading' | 'inspection_item' | 'checklist_item' | 'custom'
export type TicketTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type TicketTaskCondition = 'good' | 'fair' | 'poor' | 'damaged'

export interface TicketTask {
  id: string
  title: string
  task_type: TicketTaskType
  status: TicketTaskStatus
  meter_number?: string
  previous_reading?: number
  current_reading?: number
  unit_of_measure?: string
  room?: string
  condition?: TicketTaskCondition
  notes?: string
  attachment_urls: string[]
  assigned_to?: string
  // billing linkage (meter_reading tasks)
  unit_id?: string
  unit_code?: string
  tenant_name?: string
  invoice_id?: string
  line_item_id?: string
  utility_key?: string
  body_html?: string
  attachments?: AttachmentFile[]
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
}

export interface TicketComment {
  id: string
  author_id: string
  author_role: string
  author_name?: string
  body: string
  body_html?: string
  attachments?: AttachmentFile[]
  attachment_urls: string[]
  created_at: string
}

export interface TicketActivity {
  id: string
  type: string
  actor_id?: string
  actor_role?: string
  actor_name?: string
  description: string
  created_at: string
}

export interface Ticket {
  id: string
  reference_number?: string
  org_id: string
  property_id: string
  property_name?: string
  unit_id?: string
  unit_label?: string
  tenant_id?: string
  tenant_name?: string
  assigned_to?: string
  assigned_to_name?: string
  creator_id: string
  creator_name?: string
  creator_role?: string
  category: TicketCategory | string
  priority: TicketPriority
  status: TicketStatus
  title: string
  description?: string
  body_html?: string
  attachments?: AttachmentFile[]
  attachment_urls: string[]
  comments: TicketComment[]
  activity: TicketActivity[]
  tasks: TicketTask[]
  submission_token?: string
  submission_data?: Record<string, unknown>
  submitted_at?: string
  resolution_notes?: string
  resolved_at?: string
  closed_at?: string
  capture_started_at?: string
  capture_completed_at?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface TicketListResponse {
  items: Ticket[]
  total: number
  page: number
  page_size: number
}

export interface TicketCounts {
  open: number
  assigned: number
  in_progress: number
  pending_review: number
  resolved: number
  closed: number
  cancelled: number
  total: number
}

export interface TicketCreatePayload {
  property_id: string
  unit_id?: string
  category: string
  priority?: string
  title: string
  description?: string
  body_html?: string
  tenant_id?: string
}

export interface TicketUpdatePayload {
  status?: string
  assigned_to?: string
  priority?: string
  title?: string
  description?: string
  resolution_notes?: string
}

export interface BulkUtilityTicketPayload {
  property_id: string
  unit_ids: string[]
  title: string
  description?: string
}

export interface TicketTaskCreatePayload {
  title: string
  task_type?: string
  meter_number?: string
  previous_reading?: number
  unit_of_measure?: string
  room?: string
  notes?: string
  assigned_to?: string
}

export interface TicketTaskUpdatePayload {
  status?: string
  title?: string
  meter_number?: string
  previous_reading?: number
  current_reading?: number
  unit_of_measure?: string
  room?: string
  condition?: string
  notes?: string
  assigned_to?: string
}
