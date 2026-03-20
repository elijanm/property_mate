export interface ConsentTemplate {
  id: string
  org_id: string
  name: string
  type: 'individual' | 'group'
  title: string
  body: string
  requires_subject_signature: boolean
  requires_collector_signature: boolean
  allow_email_signing: boolean
  active: boolean
  is_global?: boolean
}

export interface ConsentSignature {
  signer_name: string
  signer_email?: string
  signed_at: string
  ip_address?: string
  lat?: number
  lng?: number
}

export interface ConsentRecord {
  id: string
  token: string
  dataset_id: string
  collector_id: string
  template_id: string
  consent_type: 'individual' | 'group'
  subject_name: string
  subject_email?: string
  representative_name?: string
  rendered_body: string
  subject_signature?: ConsentSignature
  collector_signature?: ConsentSignature
  pdf_key?: string
  offline_photo_key?: string
  offline_photo_url?: string
  entry_ids: string[]
  status: 'pending' | 'subject_signed' | 'complete' | 'void'
  email_sent_at?: string
  created_at: string
  updated_at: string
}

export interface ConsentRecordListResponse {
  items: ConsentRecord[]
  total: number
  page: number
  page_size: number
  total_pages: number
}
