import client from './client'
import type { DatasetProfile, DatasetCollector, DatasetEntry, DatasetCreatePayload, CollectFormDefinition, DatasetOverview } from '@/types/dataset'

export const datasetsApi = {
  list: () =>
    client.get<DatasetProfile[]>('/datasets').then(r => r.data),

  create: (data: DatasetCreatePayload) =>
    client.post<DatasetProfile>('/datasets', data).then(r => r.data),

  get: (id: string) =>
    client.get<DatasetProfile>(`/datasets/${id}`).then(r => r.data),

  update: (id: string, data: Partial<DatasetCreatePayload> & { status?: string }) =>
    client.patch<DatasetProfile>(`/datasets/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    client.delete(`/datasets/${id}`),

  invite: (id: string, email: string, name?: string, message?: string) =>
    client.post<DatasetCollector>(`/datasets/${id}/invite`, { email, name: name ?? '', message: message ?? '' }).then(r => r.data),

  listCollectors: (id: string) =>
    client.get<DatasetCollector[]>(`/datasets/${id}/collectors`).then(r => r.data),

  removeCollector: (datasetId: string, collectorId: string) =>
    client.delete(`/datasets/${datasetId}/collectors/${collectorId}`),

  getEntries: (id: string, params?: { field_id?: string; collector_id?: string; date_from?: string; date_to?: string }) =>
    client.get<DatasetEntry[]>(`/datasets/${id}/entries`, { params }).then(r => r.data),

  getEntryCount: (id: string) =>
    client.get<{ dataset_id: string; count: number }>(`/datasets/${id}/entry-count`).then(r => r.data),

  getOverview: (id: string) =>
    client.get<DatasetOverview>(`/datasets/${id}/overview`).then(r => r.data),

  uploadEntryDirect: (datasetId: string, fieldId: string, file: File | null, textValue?: string) => {
    const fd = new FormData()
    fd.append('field_id', fieldId)
    if (file) fd.append('file', file)
    if (textValue !== undefined && textValue !== null) fd.append('text_value', textValue)
    return client.post<DatasetEntry>(`/datasets/${datasetId}/entries/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  getBySlug: (slug: string) =>
    client.get<DatasetProfile>(`/datasets/by-slug/${encodeURIComponent(slug)}`).then(r => r.data),

  listPublic: () =>
    client.get<DatasetProfile[]>('/datasets/public').then(r => r.data),

  setVisibility: (id: string, visibility: 'private' | 'public') =>
    client.patch<DatasetProfile>(`/datasets/${id}/visibility`, { visibility }).then(r => r.data),

  clone: (id: string) =>
    client.post<DatasetProfile>(`/datasets/${id}/clone`).then(r => r.data),

  reference: (id: string) =>
    client.post<DatasetProfile>(`/datasets/${id}/reference`).then(r => r.data),
}

// ── Public collect API (no auth) ────────────────────────────────────────────
const publicClient = client  // same base URL; collect endpoints are public (no 401 risk)

export const collectApi = {
  getForm: (token: string) =>
    publicClient.get<CollectFormDefinition>(`/collect/${token}`).then(r => r.data),

  submit: (
    token: string,
    fieldId: string,
    file: File | null,
    textValue?: string,
    description?: string,
    location?: { lat: number; lng: number; accuracy?: number } | null,
  ) => {
    const fd = new FormData()
    fd.append('field_id', fieldId)
    if (file) fd.append('file', file)
    if (textValue !== undefined && textValue !== null) fd.append('text_value', textValue)
    if (description !== undefined && description !== null) fd.append('description', description)
    if (location) {
      fd.append('lat', String(location.lat))
      fd.append('lng', String(location.lng))
      if (location.accuracy != null) fd.append('accuracy', String(location.accuracy))
    }
    return publicClient.post<DatasetEntry>(`/collect/${token}/submit`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  getMyEntries: (token: string) =>
    publicClient.get<DatasetEntry[]>(`/collect/${token}/entries`).then(r => r.data),

  getMyPoints: (token: string) =>
    publicClient.get<{ points_earned: number; entry_count: number; points_enabled: boolean; points_redemption_info: string }>(
      `/collect/${token}/points`
    ).then(r => r.data),
}
