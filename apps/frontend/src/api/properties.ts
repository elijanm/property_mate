import client from './client'
import type { BillingSettings, InventoryConfig, LateFeeSetting, Property, PropertyCreateRequest, PropertyCreateResponse, PropertyUpdateRequest, PaymentConfig } from '@/types/property'
import type { PaginatedResponse } from '@/types/api'

export const propertiesApi = {
  create: (data: PropertyCreateRequest) =>
    client.post<PropertyCreateResponse>('/properties', data).then((r) => r.data),

  list: (params?: { status?: string; page?: number; page_size?: number }) =>
    client
      .get<PaginatedResponse<Property>>('/properties', { params })
      .then((r) => r.data),

  get: (id: string) =>
    client.get<Property>(`/properties/${id}`).then((r) => r.data),

  update: (id: string, data: PropertyUpdateRequest) =>
    client.patch<Property>(`/properties/${id}`, data).then((r) => r.data),

  updatePaymentConfig: (id: string, data: Partial<PaymentConfig>) =>
    client.patch<Property>(`/properties/${id}/payment-config`, data).then((r) => r.data),

  uploadSignature: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<Property>(`/properties/${id}/signature`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data)
  },

  updateSignatureConfig: (id: string, data: { signatory_name?: string; signatory_title?: string }) =>
    client.patch<Property>(`/properties/${id}/signature-config`, data).then((r) => r.data),

  deleteSignature: (id: string) =>
    client.delete<Property>(`/properties/${id}/signature`).then((r) => r.data),

  updateBillingSettings: (id: string, data: Partial<BillingSettings>) =>
    client.patch<Property>(`/properties/${id}`, { billing_settings: data }).then((r) => r.data),

  installApp: (propertyId: string, appId: string) =>
    client.post<Property>(`/properties/${propertyId}/apps/install`, { app_id: appId }).then((r) => r.data),

  uninstallApp: (propertyId: string, appId: string) =>
    client.delete<void>(`/properties/${propertyId}/apps/${appId}`).then((r) => r.data),

  updateInventoryConfig: (propertyId: string, data: Partial<InventoryConfig>) =>
    client.patch<Property>(`/properties/${propertyId}/inventory-config`, data).then((r) => r.data),

  updateLateFeeSetting: (propertyId: string, data: Partial<LateFeeSetting>) =>
    client.patch<Property>(`/properties/${propertyId}/late-fee-setting`, data).then((r) => r.data),

  applyBulkDiscount: (propertyId: string, data: object) =>
    client.post<{ applied_to: number }>(`/properties/${propertyId}/bulk-discount`, data).then((r) => r.data),
}
