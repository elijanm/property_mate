import client from './client'
import type { MeterReading, MeterReadingCreateRequest, MeterReadingListResponse } from '@/types/meter_reading'

export const meterReadingsApi = {
  record: (propertyId: string, data: MeterReadingCreateRequest) =>
    client
      .post<MeterReading>(`/properties/${propertyId}/meter-readings`, data)
      .then((r) => r.data),

  list: (
    propertyId: string,
    params?: { unit_id?: string; utility_key?: string; page?: number; page_size?: number },
  ) =>
    client
      .get<MeterReadingListResponse>(`/properties/${propertyId}/meter-readings`, { params })
      .then((r) => r.data),
}
