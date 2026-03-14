import client from './client'
import axios from 'axios'
import type {
  InventoryCounts,
  InventoryItem,
  InventoryItemCreatePayload,
  InventoryItemUpdatePayload,
  InventoryListResponse,
  InventoryVariantPayload,
  SerialMergePayload,
  SerialSplitPayload,
  ShipmentCreatePayload,
  ShipmentListResponse,
  ShipmentPublicContext,
  ShipmentSignPayload,
  StockAdjustPayload,
  StockDamagedPayload,
  StockInPayload,
  StockOutPayload,
  StockShipment,
  StockTransferPayload,
} from '@/types/inventory'

// Public sign client (no auth header)
const publicClient = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL ?? '/api/v1'),
})

interface InventoryListParams {
  property_id?: string
  category?: string
  status?: string
  low_stock_only?: boolean
  hazard_class?: string
  search?: string
  page?: number
  page_size?: number
}

export const inventoryApi = {
  list: (params?: InventoryListParams) =>
    client.get<InventoryListResponse>('/inventory', { params }).then((r) => r.data),

  getCounts: (params?: { property_id?: string }) =>
    client.get<InventoryCounts>('/inventory/counts', { params }).then((r) => r.data),

  get: (id: string) =>
    client.get<InventoryItem>(`/inventory/${id}`).then((r) => r.data),

  create: (data: InventoryItemCreatePayload) =>
    client.post<InventoryItem>('/inventory', data).then((r) => r.data),

  update: (id: string, data: InventoryItemUpdatePayload) =>
    client.patch<InventoryItem>(`/inventory/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    client.delete(`/inventory/${id}`).then((r) => r.data),

  stockIn: (id: string, data: StockInPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/stock-in`, data).then((r) => r.data),

  stockOut: (id: string, data: StockOutPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/stock-out`, data).then((r) => r.data),

  adjust: (id: string, data: StockAdjustPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/adjust`, data).then((r) => r.data),

  transfer: (id: string, data: StockTransferPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/transfer`, data).then((r) => r.data),

  recordDamaged: (id: string, data: StockDamagedPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/damaged`, data).then((r) => r.data),

  mergeSerials: (id: string, data: SerialMergePayload) =>
    client.post<InventoryItem>(`/inventory/${id}/serials/merge`, data).then((r) => r.data),

  splitSerial: (id: string, data: SerialSplitPayload) =>
    client.post<InventoryItem>(`/inventory/${id}/serials/split`, data).then((r) => r.data),

  // Variants
  createVariant: (itemId: string, data: InventoryVariantPayload) =>
    client.post<InventoryItem>(`/inventory/${itemId}/variants`, data).then((r) => r.data),

  updateVariant: (itemId: string, variantId: string, data: Partial<InventoryVariantPayload> & { status?: string }) =>
    client.patch<InventoryItem>(`/inventory/${itemId}/variants/${variantId}`, data).then((r) => r.data),

  deleteVariant: (itemId: string, variantId: string) =>
    client.delete<InventoryItem>(`/inventory/${itemId}/variants/${variantId}`).then((r) => r.data),

  uploadImage: (itemId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<InventoryItem>(`/inventory/${itemId}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  uploadVariantImage: (itemId: string, variantId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client
      .post<InventoryItem>(`/inventory/${itemId}/variants/${variantId}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  // Shipment (admin)
  createShipment: (data: ShipmentCreatePayload) =>
    client.post<StockShipment>('/inventory/shipments', data).then((r) => r.data),

  listShipments: (params?: { status?: string; page?: number; page_size?: number }) =>
    client.get<ShipmentListResponse>('/inventory/shipments', { params }).then((r) => r.data),

  getShipment: (id: string) =>
    client.get<StockShipment>(`/inventory/shipments/${id}`).then((r) => r.data),

  getShipmentPdf: (id: string) =>
    client.get<{ url: string }>(`/inventory/shipments/${id}/pdf`).then((r) => r.data),
}

// Public sign API (no auth)
export const shipmentSignApi = {
  getDriverContext: (token: string) =>
    publicClient.get<ShipmentPublicContext>(`/shipment-sign/${token}/driver`).then((r) => r.data),

  signDriver: (token: string, data: ShipmentSignPayload) =>
    publicClient.post<{ ok: boolean; status: string }>(`/shipment-sign/${token}/driver/sign`, data).then((r) => r.data),

  getReceiverContext: (token: string) =>
    publicClient.get<ShipmentPublicContext>(`/shipment-sign/${token}/receiver`).then((r) => r.data),

  signReceiver: (token: string, data: ShipmentSignPayload) =>
    publicClient.post<{ ok: boolean; status: string }>(`/shipment-sign/${token}/receiver/sign`, data).then((r) => r.data),
}
