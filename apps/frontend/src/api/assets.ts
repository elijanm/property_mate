import client from './client'
import type {
  Asset,
  AssetCheckinPayload,
  AssetCheckoutPayload,
  AssetCounts,
  AssetCreatePayload,
  AssetDisposePayload,
  AssetListResponse,
  AssetMaintenancePayload,
  AssetTransferPayload,
  AssetUpdatePayload,
  AssetValuationPayload,
  AssetWriteOffPayload,
} from '@/types/asset'

interface AssetListParams {
  property_id?: string
  unit_id?: string
  category?: string
  lifecycle_status?: string
  condition?: string
  assigned_to?: string
  search?: string
  page?: number
  page_size?: number
}

export const assetsApi = {
  list: (params?: AssetListParams) =>
    client.get<AssetListResponse>('/assets', { params }).then((r) => r.data),

  getCounts: (params?: { property_id?: string }) =>
    client.get<AssetCounts>('/assets/counts', { params }).then((r) => r.data),

  get: (id: string) =>
    client.get<Asset>(`/assets/${id}`).then((r) => r.data),

  create: (data: AssetCreatePayload) =>
    client.post<Asset>('/assets', data).then((r) => r.data),

  update: (id: string, data: AssetUpdatePayload) =>
    client.patch<Asset>(`/assets/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    client.delete(`/assets/${id}`).then((r) => r.data),

  transfer: (id: string, data: AssetTransferPayload) =>
    client.post<Asset>(`/assets/${id}/transfer`, data).then((r) => r.data),

  checkout: (id: string, data: AssetCheckoutPayload) =>
    client.post<Asset>(`/assets/${id}/checkout`, data).then((r) => r.data),

  checkin: (id: string, data: AssetCheckinPayload) =>
    client.post<Asset>(`/assets/${id}/checkin`, data).then((r) => r.data),

  addMaintenance: (id: string, data: AssetMaintenancePayload) =>
    client.post<Asset>(`/assets/${id}/maintenance`, data).then((r) => r.data),

  addValuation: (id: string, data: AssetValuationPayload) =>
    client.post<Asset>(`/assets/${id}/valuations`, data).then((r) => r.data),

  dispose: (id: string, data: AssetDisposePayload) =>
    client.post<Asset>(`/assets/${id}/dispose`, data).then((r) => r.data),

  writeOff: (id: string, data: AssetWriteOffPayload) =>
    client.post<Asset>(`/assets/${id}/write-off`, data).then((r) => r.data),
}
