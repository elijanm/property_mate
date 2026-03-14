import client from './client'
import type { PaginatedResponse } from '@/types/api'

export interface UtilityContractLine {
  key: string
  label: string
  type: string          // shared | metered | subscription
  rate?: number
  unit_label?: string
  deposit?: number
}

export interface PaymentConfigSummary {
  paybill_number?: string
  till_number?: string
  bank_name?: string
  bank_account?: string
  bank_branch?: string
  online_payment_enabled: boolean
  account_reference?: string   // resolved: unit_code value, tenant_id, or custom string
}

export interface LeaseSummary {
  lease_id: string
  status?: string
  reference_no?: string
  unit_code?: string
  property_name?: string
  property_address?: string
  rent_amount: number
  deposit_amount: number
  utility_deposit?: number
  start_date?: string
  end_date?: string
  notes?: string
  // billing
  invoice_day: number
  due_days: number
  grace_days: number
  late_fee_type: string
  late_fee_value: number
  // lease defaults
  notice_days: number
  termination_fee_type: string
  termination_fee_value?: number
  deposit_refund_days: number
  // utilities
  utilities: UtilityContractLine[]
  payment_config?: PaymentConfigSummary
}

export interface OnboardingPayRequest {
  phone: string
  amount: number
  sandbox: boolean
}

export interface OnboardingPayResponse {
  payment_id: string
  status: string
  message: string
}

export interface OnboardingPayStatusResponse {
  status: 'pending' | 'completed' | 'failed'
  lease_status: string
  message?: string
}

export interface OnboardingResponse {
  id: string
  org_id: string
  property_id: string
  unit_id?: string
  tenant_id?: string
  lease_id?: string
  status: string
  initiated_by: string
  notes?: string
  invite_email?: string
  invite_sent_at?: string
  invite_link?: string
  id_type?: string
  id_number?: string
  id_front_url?: string
  id_back_url?: string
  selfie_url?: string
  first_name?: string
  last_name?: string
  date_of_birth?: string
  phone?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  created_at: string
  updated_at: string
}

export interface OnboardingPublicResponse {
  id: string
  status: string
  invite_email?: string
  first_name?: string
  last_name?: string
  date_of_birth?: string
  phone?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  id_type?: string
  id_number?: string
  has_id_front: boolean
  has_id_back: boolean
  has_selfie: boolean
  has_signature: boolean
  has_owner_signature: boolean
  // Org branding for contract letterhead
  org_name?: string
  org_logo_url?: string
  org_phone?: string
  org_email?: string
  org_address?: string
  lease?: LeaseSummary
}

export interface OnboardingCreateRequest {
  property_id: string
  tenant_id?: string
  lease_id?: string
  notes?: string
}

export interface OnboardingDetailsRequest {
  id_type?: string
  id_number?: string
  first_name?: string
  last_name?: string
  date_of_birth?: string
  phone?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
}

export const onboardingsApi = {
  create: (data: OnboardingCreateRequest) =>
    client.post<OnboardingResponse>('/onboardings', data).then((r) => r.data),

  list: (params?: { property_id?: string; tenant_id?: string; lease_id?: string; status?: string; page?: number }) =>
    client
      .get<PaginatedResponse<OnboardingResponse>>('/onboardings', { params })
      .then((r) => r.data),

  get: (id: string) =>
    client.get<OnboardingResponse>(`/onboardings/${id}`).then((r) => r.data),

  sendInvite: (id: string, email: string) =>
    client.post<OnboardingResponse>(`/onboardings/${id}/invite`, { email }).then((r) => r.data),

  reserveUnit: (id: string, unitId: string) =>
    client
      .post<OnboardingResponse>(`/onboardings/${id}/reserve-unit`, { unit_id: unitId })
      .then((r) => r.data),

  // Public (token-based, no auth header needed)
  getByToken: (token: string) =>
    client.get<OnboardingPublicResponse>(`/onboardings/invite/${token}`).then((r) => r.data),

  uploadIdFront: (token: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OnboardingPublicResponse>(`/onboardings/invite/${token}/upload-id-front`, fd)
      .then((r) => r.data)
  },

  uploadIdBack: (token: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OnboardingPublicResponse>(`/onboardings/invite/${token}/upload-id-back`, fd)
      .then((r) => r.data)
  },

  uploadSelfie: (token: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OnboardingPublicResponse>(`/onboardings/invite/${token}/upload-selfie`, fd)
      .then((r) => r.data)
  },

  submitDetails: (token: string, data: OnboardingDetailsRequest) =>
    client
      .patch<OnboardingPublicResponse>(`/onboardings/invite/${token}/details`, data)
      .then((r) => r.data),

  sign: (token: string, signatureData: string) =>
    client
      .post<OnboardingPublicResponse>(`/onboardings/invite/${token}/sign`, { signature_data: signatureData })
      .then((r) => r.data),

  initiatePayment: (token: string, data: OnboardingPayRequest) =>
    client
      .post<OnboardingPayResponse>(`/onboardings/invite/${token}/pay`, data)
      .then((r) => r.data),

  getPayStatus: (token: string, paymentId: string) =>
    client
      .get<OnboardingPayStatusResponse>(`/onboardings/invite/${token}/pay-status`, {
        params: { payment_id: paymentId },
      })
      .then((r) => r.data),

  getDocuments: (onboardingId: string, mfaSessionToken: string) =>
    client
      .get<import('@/types/mfa').OnboardingDocuments>(`/onboardings/${onboardingId}/documents`, {
        headers: { 'X-MFA-Session-Token': mfaSessionToken },
      })
      .then((r) => r.data),

  ownerSign: (onboardingId: string, signatureData: string, signedBy?: string) =>
    client
      .post<OnboardingResponse>(`/onboardings/${onboardingId}/owner-sign`, {
        signature_data: signatureData,
        signed_by: signedBy,
      })
      .then((r) => r.data),

  getLeasePdfUrl: (onboardingId: string) =>
    client.get<{ url: string }>(`/onboardings/${onboardingId}/lease-pdf`).then((r) => r.data),

  // Public verification (no auth required)
  verifyByCode: (onboardingId: string, code: string) =>
    client
      .get<OnboardingVerifyResponse>(`/onboardings/verify/${onboardingId}`, { params: { code } })
      .then((r) => r.data),

  verifyByDocument: (onboardingId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OnboardingVerifyResponse>(`/onboardings/verify/${onboardingId}/document`, fd)
      .then((r) => r.data)
  },
}

export interface OnboardingVerifyResponse {
  onboarding_id: string
  is_authentic: boolean
  tenant_name?: string
  property_name?: string
  unit_code?: string
  start_date?: string
  end_date?: string
  rent_amount?: number
  signed_at?: string
  owner_signed_at?: string
  owner_signed_by?: string
  doc_fingerprint?: string
  status: string
}
