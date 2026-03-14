import client from './client'
import type {
  InspectionCreateRequest,
  InspectionReport,
} from '@/types/inspection'

export const inspectionsApi = {
  // Authenticated
  list: (leaseId: string) =>
    client.get<InspectionReport[]>(`/leases/${leaseId}/inspections`).then((r) => r.data),

  create: (leaseId: string, data: InspectionCreateRequest) =>
    client.post<InspectionReport>(`/leases/${leaseId}/inspections`, data).then((r) => r.data),

  review: (reportId: string) =>
    client.post<InspectionReport>(`/inspections/${reportId}/review`).then((r) => r.data),

  // Public (no auth)
  getByToken: (token: string) =>
    client.get<InspectionReport>(`/inspections/report/${token}`).then((r) => r.data),

  addMeter: (token: string, data: {
    utility_key: string
    utility_label: string
    reading: number
    unit_label: string
  }, file?: File) => {
    const form = new FormData()
    form.append('utility_key', data.utility_key)
    form.append('utility_label', data.utility_label)
    form.append('reading', String(data.reading))
    form.append('unit_label', data.unit_label)
    if (file) form.append('photo', file)
    return client
      .post<InspectionReport>(`/inspections/report/${token}/meters`, form)
      .then((r) => r.data)
  },

  addDefect: (token: string, data: { location: string; description: string }, photos: File[]) => {
    const form = new FormData()
    form.append('location', data.location)
    form.append('description', data.description)
    photos.forEach((f) => form.append('photos', f))
    return client
      .post<InspectionReport>(`/inspections/report/${token}/defects`, form)
      .then((r) => r.data)
  },

  submit: (token: string) =>
    client.post<InspectionReport>(`/inspections/report/${token}/submit`).then((r) => r.data),
}
