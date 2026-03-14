import client from './client'
import type {
  StoreCapacitySummary,
  StoreConfigUpdatePayload,
  StoreCreatePayload,
  StoreListResponse,
  StoreLocation,
  StoreLocationCreatePayload,
  StoreLocationUpdatePayload,
} from '@/types/store'

export const storesApi = {
  list: (propertyId: string) =>
    client.get<StoreListResponse>(`/properties/${propertyId}/stores`).then((r) => r.data),

  listAllLocations: (propertyId: string) =>
    client.get<StoreLocation[]>(`/properties/${propertyId}/stores/locations`).then((r) => r.data),

  create: (propertyId: string, data: StoreCreatePayload) =>
    client.post<StoreLocation>(`/properties/${propertyId}/stores`, data).then((r) => r.data),

  getTree: (propertyId: string, storeId: string) =>
    client.get<StoreLocation>(`/properties/${propertyId}/stores/${storeId}/tree`).then((r) => r.data),

  getCapacity: (propertyId: string, storeId: string) =>
    client
      .get<StoreCapacitySummary[]>(`/properties/${propertyId}/stores/${storeId}/capacity`)
      .then((r) => r.data),

  createLocation: (propertyId: string, storeId: string, data: StoreLocationCreatePayload) =>
    client
      .post<StoreLocation>(`/properties/${propertyId}/stores/${storeId}/locations`, data)
      .then((r) => r.data),

  updateLocation: (propertyId: string, locationId: string, data: StoreLocationUpdatePayload) =>
    client
      .patch<StoreLocation>(`/properties/${propertyId}/stores/locations/${locationId}`, data)
      .then((r) => r.data),

  deleteLocation: (propertyId: string, locationId: string) =>
    client.delete(`/properties/${propertyId}/stores/locations/${locationId}`).then((r) => r.data),

  updateConfig: (propertyId: string, data: StoreConfigUpdatePayload) =>
    client
      .patch<Record<string, unknown>>(`/properties/${propertyId}/stores/config`, data)
      .then((r) => r.data),
}
