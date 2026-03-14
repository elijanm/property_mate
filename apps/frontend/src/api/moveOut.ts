import apiClient from './client'
import type { MoveOutInspection } from '@/types/moveOut'

export const moveOutApi = {
  create: (leaseId: string, data: { scheduled_date?: string; inspector_notes?: string }) =>
    apiClient.post<MoveOutInspection>(`/leases/${leaseId}/move-out`, data).then(r => r.data),

  get: (leaseId: string) =>
    apiClient.get<MoveOutInspection>(`/leases/${leaseId}/move-out`).then(r => r.data),

  updateChecklist: (leaseId: string, itemId: string, data: { checked?: boolean; notes?: string }) =>
    apiClient.patch<MoveOutInspection>(`/leases/${leaseId}/move-out/checklist/${itemId}`, data).then(r => r.data),

  addDamage: (leaseId: string, data: {
    description: string
    location: string
    severity: string
    estimated_cost: number
    deduct_from_deposit: boolean
  }) =>
    apiClient.post<MoveOutInspection>(`/leases/${leaseId}/move-out/damages`, data).then(r => r.data),

  uploadDamagePhoto: (leaseId: string, damageId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post<MoveOutInspection>(`/leases/${leaseId}/move-out/damages/${damageId}/photo`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  approve: (leaseId: string, data: { deposit_deduction: number; inspector_notes?: string }) =>
    apiClient.post<MoveOutInspection>(`/leases/${leaseId}/move-out/approve`, data).then(r => r.data),
}
