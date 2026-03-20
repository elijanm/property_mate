import client from './client'
import type { ConsentTemplate, ConsentRecord, ConsentRecordListResponse } from '@/types/consent'

// Public client — same instance, consent public endpoints don't require auth
const publicClient = client

export const consentApi = {
  // ── Admin template endpoints ────────────────────────────────────────────────
  listTemplates: () =>
    client.get<ConsentTemplate[]>('/consent/templates').then(r => r.data),

  createTemplate: (data: Partial<ConsentTemplate>) =>
    client.post<ConsentTemplate>('/consent/templates', data).then(r => r.data),

  updateTemplate: (id: string, data: Partial<ConsentTemplate>) =>
    client.patch<ConsentTemplate>(`/consent/templates/${id}`, data).then(r => r.data),

  deleteTemplate: (id: string) =>
    client.delete(`/consent/templates/${id}`),

  listGlobalTemplates: () =>
    client.get<ConsentTemplate[]>('/consent/templates/global').then(r => r.data),

  updateGlobalTemplate: (id: string, data: Partial<ConsentTemplate>) =>
    client.patch<ConsentTemplate>(`/consent/templates/global/${id}`, data).then(r => r.data),

  // ── Org consent records ─────────────────────────────────────────────────────
  listRecords: (params?: { dataset_id?: string; page?: number; page_size?: number }) =>
    client.get<ConsentRecordListResponse>('/consent/records', { params }).then(r => r.data),

  getRecordPdfUrl: (token: string) =>
    client.get<{ url: string }>(`/consent/records/${token}/pdf`).then(r => r.data),

  voidRecord: (token: string) =>
    client.delete(`/consent/records/${token}`),

  // ── Public endpoints ────────────────────────────────────────────────────────
  initiate: (
    collectToken: string,
    data: {
      subject_name: string
      subject_email?: string
      representative_name?: string
      consent_type?: string
    }
  ) =>
    publicClient.post<ConsentRecord>(`/consent/initiate/${collectToken}`, data).then(r => r.data),

  getForSigning: (recordToken: string) =>
    publicClient.get<ConsentRecord>(`/consent/sign/${recordToken}`).then(r => r.data),

  sign: (
    recordToken: string,
    data: {
      role: 'subject' | 'collector'
      signature_data: string
      signer_name: string
      signer_email?: string
      lat?: number
      lng?: number
    }
  ) =>
    publicClient.post<ConsentRecord>(`/consent/sign/${recordToken}`, data).then(r => r.data),

  signOfflinePhoto: (
    recordToken: string,
    photo: File,
    collectorName: string,
  ) => {
    const fd = new FormData()
    fd.append('file', photo)
    fd.append('collector_name', collectorName)
    return publicClient.post<ConsentRecord>(
      `/consent/sign/${recordToken}/offline-photo?collector_name=${encodeURIComponent(collectorName)}`,
      fd, { headers: { 'Content-Type': 'multipart/form-data' } }
    ).then(r => r.data)
  },

  getForEmailSigning: (emailToken: string) =>
    publicClient.get<ConsentRecord>(`/consent/email-sign/${emailToken}`).then(r => r.data),

  signByEmail: (
    emailToken: string,
    data: {
      signature_data: string
      signer_name: string
      lat?: number
      lng?: number
    }
  ) =>
    publicClient.post<ConsentRecord>(`/consent/email-sign/${emailToken}`, data).then(r => r.data),
}
