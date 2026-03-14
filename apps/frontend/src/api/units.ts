import client from './client'
import type { Unit, UnitUpdateRequest, BulkUpdateRequest, BulkUpdateResponse, UnitPricingResponse } from '@/types/unit'
import type { PaginatedResponse } from '@/types/api'

export const unitsApi = {
  list: (
    propertyId: string,
    params?: { status?: string; wing?: string; floor?: number; unit_type?: string; page?: number; page_size?: number }
  ) =>
    client
      .get<PaginatedResponse<Unit>>(`/properties/${propertyId}/units`, { params })
      .then((r) => r.data),

  update: (unitId: string, data: UnitUpdateRequest) =>
    client.patch<Unit>(`/units/${unitId}`, data).then((r) => r.data),

  bulkUpdate: (propertyId: string, data: BulkUpdateRequest) =>
    client
      .post<BulkUpdateResponse>(`/properties/${propertyId}/units/bulk-update`, data)
      .then((r) => r.data),

  reserve: (unitId: string, tenantId: string, onboardingId?: string) =>
    client
      .post<Unit>(`/units/${unitId}/reserve`, { tenant_id: tenantId, onboarding_id: onboardingId })
      .then((r) => r.data),

  releaseReservation: (unitId: string) =>
    client.post<Unit>(`/units/${unitId}/release-reservation`).then((r) => r.data),

  getPricing: (unitId: string, moveInDate?: string) =>
    client
      .get<UnitPricingResponse>(`/units/${unitId}/pricing`, {
        params: moveInDate ? { move_in_date: moveInDate } : undefined,
      })
      .then((r) => r.data),

  seedWaterReadings: (unitId: string) =>
    client.post<{ inserted: number; unit_id: string; utility_key: string }>(
      `/units/${unitId}/seed-water-readings`
    ).then((r) => r.data),
}
