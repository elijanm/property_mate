export type CommChannel = 'email' | 'whatsapp' | 'sms'
export type CommIntent  = 'free' | 'arrears' | 'promotion'

export interface BulkSendRecipient {
  tenant_id: string
  lease_id: string
  message: string
  subject?: string
  phone?: string
  email?: string
}

export interface BulkSendPayload {
  channel: CommChannel
  recipients: BulkSendRecipient[]
}

export interface BulkSendResult {
  sent: number
  failed: number
  errors: Array<{ tenant_id: string; error: string }>
}
