import client from './client'
import type { DatasetProfile, DatasetCollector, DatasetEntry, DatasetEntryListResponse, SimilarDatasetEntry, DatasetCreatePayload, CollectFormDefinition, DatasetOverview } from '@/types/dataset'

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

  addCollector: (id: string, name: string, email?: string, phone?: string) =>
    client.post<DatasetCollector>(`/datasets/${id}/collectors`, { name, email: email ?? '', phone: phone ?? '' }).then(r => r.data),

  listCollectors: (id: string) =>
    client.get<DatasetCollector[]>(`/datasets/${id}/collectors`).then(r => r.data),

  removeCollector: (datasetId: string, collectorId: string) =>
    client.delete(`/datasets/${datasetId}/collectors/${collectorId}`),

  getEntries: (id: string, params?: {
    field_id?: string
    collector_id?: string
    date_from?: string
    date_to?: string
    review_status?: string
    quality?: string
    include_archived?: boolean
    page?: number
    page_size?: number
  }) =>
    client.get<DatasetEntryListResponse>(`/datasets/${id}/entries`, { params }).then(r => r.data),

  archiveEntry: (datasetId: string, entryId: string, archived = true) =>
    client.post<DatasetEntry>(`/datasets/${datasetId}/entries/${entryId}/archive`, { archived }).then(r => r.data),

  findSimilarEntries: (datasetId: string, entryId: string, threshold = 12) =>
    client.get<SimilarDatasetEntry[]>(`/datasets/${datasetId}/entries/${entryId}/similar`, { params: { threshold } }).then(r => r.data),

  exportToAnnotation: (datasetId: string, projectId: string, entryIds?: string[]) =>
    client.post<{ added: number; skipped: number; project_id: string }>(
      `/datasets/${datasetId}/export-to-annotation`,
      { project_id: projectId, entry_ids: entryIds ?? null }
    ).then(r => r.data),

  reviewEntry: (datasetId: string, entryId: string, status: 'approved' | 'rejected', note?: string) =>
    client.patch<DatasetEntry>(`/datasets/${datasetId}/entries/${entryId}/review`, { status, note }).then(r => r.data),

  deleteEntry: (datasetId: string, entryId: string) =>
    client.delete(`/datasets/${datasetId}/entries/${entryId}`),

  getEntryCount: (id: string) =>
    client.get<{ dataset_id: string; count: number }>(`/datasets/${id}/entry-count`).then(r => r.data),

  getOverview: (id: string) =>
    client.get<DatasetOverview>(`/datasets/${id}/overview`).then(r => r.data),

  exportCsv: async (id: string, filename: string) => {
    const resp = await client.get(`/datasets/${id}/export`, { responseType: 'blob' })
    const url = URL.createObjectURL(resp.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  },

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
    consentRecordId?: string | null,
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
    if (consentRecordId) fd.append('consent_record_id', consentRecordId)
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

  initiateMultipart: (token: string, fieldId: string, filename: string, contentType: string) =>
    publicClient.post<{ upload_id: string; key: string }>(
      `/collect/${token}/multipart/initiate`,
      { field_id: fieldId, filename, content_type: contentType }
    ).then(r => r.data),

  getPartUrl: (token: string, key: string, uploadId: string, partNumber: number) =>
    publicClient.get<{ url: string }>(
      `/collect/${token}/multipart/part-url`,
      { params: { key, upload_id: uploadId, part_number: partNumber } }
    ).then(r => r.data),

  completeMultipart: (
    token: string,
    payload: {
      field_id: string; key: string; upload_id: string;
      parts: { part_number: number; etag: string }[];
      file_mime: string; description?: string;
      lat?: number; lng?: number; accuracy?: number;
      file_hash?: string;
      consent_record_id?: string | null;
    }
  ) =>
    publicClient.post<DatasetEntry>(`/collect/${token}/multipart/complete`, payload).then(r => r.data),
}
