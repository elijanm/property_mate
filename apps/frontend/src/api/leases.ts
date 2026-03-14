import client from './client'
import type { Lease, LeaseCreateRequest, LeaseDiscountPayload } from '@/types/lease'
import type { LeaseTemplate } from '@/types/leaseTemplate'
import type { PaginatedResponse } from '@/types/api'

export const leasesApi = {
  create: (propertyId: string, data: LeaseCreateRequest) =>
    client.post<Lease>(`/properties/${propertyId}/leases`, data).then((r) => r.data),

  list: (propertyId: string, params?: { status?: string; page?: number; page_size?: number }) =>
    client
      .get<PaginatedResponse<Lease>>(`/properties/${propertyId}/leases`, { params })
      .then((r) => r.data),

  get: (leaseId: string) =>
    client.get<Lease>(`/leases/${leaseId}`).then((r) => r.data),

  activate: (leaseId: string) =>
    client.post<Lease>(`/leases/${leaseId}/activate`).then((r) => r.data),

  sign: (leaseId: string) =>
    client.post<Lease>(`/leases/${leaseId}/sign`).then((r) => r.data),

  myLeases: () =>
    client.get<PaginatedResponse<Lease>>('/tenant/leases').then((r) => r.data),

  terminate: (leaseId: string) =>
    client.post<Lease>(`/leases/${leaseId}/terminate`).then((r) => r.data),

  resendInvite: (leaseId: string) =>
    client.post<void>(`/leases/${leaseId}/resend-invite`).then((r) => r.data),

  getPdf: (leaseId: string) =>
    client.get<{ url: string }>(`/leases/${leaseId}/pdf`).then((r) => r.data),

  addDiscount: (leaseId: string, data: LeaseDiscountPayload) =>
    client.post<Lease>(`/leases/${leaseId}/discounts`, data).then((r) => r.data),

  removeDiscount: (leaseId: string, discountId: string) =>
    client.delete<Lease>(`/leases/${leaseId}/discounts/${discountId}`).then((r) => r.data),

  // Escalations
  addEscalation: (leaseId: string, data: { effective_date: string; new_rent_amount: number; note?: string }) =>
    client.post<Lease>(`/leases/${leaseId}/escalations`, data).then((r) => r.data),

  removeEscalation: (leaseId: string, escalationId: string) =>
    client.delete<Lease>(`/leases/${leaseId}/escalations/${escalationId}`).then((r) => r.data),

  // Early termination
  setEarlyTermination: (leaseId: string, data: object) =>
    client.put<Lease>(`/leases/${leaseId}/early-termination`, data).then((r) => r.data),

  // Renewal
  sendRenewalOffer: (leaseId: string, data: { new_rent_amount: number; new_end_date?: string; message?: string }) =>
    client.post<Lease>(`/leases/${leaseId}/renewal-offer`, data).then((r) => r.data),

  respondRenewal: (leaseId: string, accept: boolean) =>
    client.post<Lease>(`/leases/${leaseId}/renewal-offer/respond`, null, { params: { accept } }).then((r) => r.data),

  // Co-tenants
  addCoTenant: (leaseId: string, data: object) =>
    client.post<Lease>(`/leases/${leaseId}/co-tenants`, data).then((r) => r.data),

  removeCoTenant: (leaseId: string, coTenantId: string) =>
    client.delete<Lease>(`/leases/${leaseId}/co-tenants/${coTenantId}`).then((r) => r.data),

  // Notes & Rating
  addNote: (leaseId: string, data: { body: string; is_private: boolean }) =>
    client.post<Lease>(`/leases/${leaseId}/notes`, data).then((r) => r.data),

  rateTenant: (leaseId: string, data: object) =>
    client.put<Lease>(`/leases/${leaseId}/rating`, data).then((r) => r.data),

  // Templates
  listTemplates: () =>
    client.get<LeaseTemplate[]>('/lease-templates').then((r) => r.data),

  createTemplate: (data: object) =>
    client.post<LeaseTemplate>('/lease-templates', data).then((r) => r.data),

  deleteTemplate: (templateId: string) =>
    client.delete<void>(`/lease-templates/${templateId}`).then((r) => r.data),
}
