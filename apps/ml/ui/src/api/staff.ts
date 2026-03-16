import client from './client'
import type { StaffMember, StaffInvitePayload, PlanStaffInfo, Contributor } from '@/types/staff'

export const staffApi = {
  list: () =>
    client
      .get<{ items: StaffMember[]; plan: PlanStaffInfo }>('/staff')
      .then((r) => r.data),

  invite: (data: StaffInvitePayload) =>
    client.post<StaffMember>('/staff/invite', data).then((r) => r.data),

  updateRole: (email: string, role: string) =>
    client
      .patch(`/staff/${encodeURIComponent(email)}/role`, { role })
      .then((r) => r.data),

  remove: (email: string) =>
    client.delete(`/staff/${encodeURIComponent(email)}`).then((r) => r.data),
}

export const contributorsApi = {
  list: (params?: { page?: number; limit?: number; search?: string; kyc_status?: string }) =>
    client
      .get<{ items: Contributor[]; total: number }>('/admin/contributors', { params })
      .then((r) => r.data),

  toggleStatus: (email: string) =>
    client
      .patch<{ email: string; is_active: boolean }>(`/admin/contributors/${encodeURIComponent(email)}/status`)
      .then((r) => r.data),
}
