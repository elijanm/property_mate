import client from './client'
import type { Tenant, TenantCreateRequest, TenantUpdateRequest } from '@/types/tenant'
import type { PaginatedResponse } from '@/types/api'

export const tenantsApi = {
  list: (params?: { page?: number; page_size?: number }) =>
    client.get<PaginatedResponse<Tenant>>('/tenants', { params }).then((r) => r.data),

  create: (data: TenantCreateRequest) =>
    client.post<Tenant>('/tenants', data).then((r) => r.data),

  get: (id: string) =>
    client.get<Tenant>(`/tenants/${id}`).then((r) => r.data),

  update: (id: string, data: TenantUpdateRequest) =>
    client.patch<Tenant>(`/tenants/${id}`, data).then((r) => r.data),
}
