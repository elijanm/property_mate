import client from './client'
import type { AIConfigUpdateRequest, BillingConfigUpdateRequest, OrgProfile, OrgUpdateRequest, OrgUserSummary } from '@/types/org'

export const orgApi = {
  listUsers: () =>
    client.get<OrgUserSummary[]>('/org/users').then((r) => r.data),


  getProfile: () =>
    client.get<OrgProfile>('/org/profile').then((r) => r.data),

  updateProfile: (data: OrgUpdateRequest) =>
    client.patch<OrgProfile>('/org/profile', data).then((r) => r.data),

  updateBillingConfig: (data: BillingConfigUpdateRequest) =>
    client.patch<OrgProfile>('/org/billing-config', data).then((r) => r.data),

  uploadLogo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OrgProfile>('/org/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data)
  },

  uploadSignature: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<OrgProfile>('/org/signature', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data)
  },

  updateSignatureConfig: (data: { signatory_name?: string; signatory_title?: string }) =>
    client.patch<OrgProfile>('/org/signature-config', data).then((r) => r.data),

  deleteSignature: () =>
    client.delete<OrgProfile>('/org/signature').then((r) => r.data),

  updateVoiceSettings: (data: { voice_api_audit_enabled?: boolean }) =>
    client.patch<OrgProfile>('/org/voice-settings', data).then((r) => r.data),

  updateDepositInterest: (data: object) =>
    client.patch<OrgProfile>('/org/deposit-interest', data).then((r) => r.data),

  updateAIConfig: (data: AIConfigUpdateRequest) =>
    client.patch<OrgProfile>('/org/ai-config', data).then((r) => r.data),
}
