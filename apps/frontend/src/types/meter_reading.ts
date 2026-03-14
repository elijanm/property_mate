export interface MeterReading {
  id: string
  org_id: string
  property_id: string
  unit_id?: string            // undefined = property-level master meter
  utility_key: string
  previous_reading?: number
  current_reading: number
  units_consumed?: number
  read_at: string
  read_by: string             // user_id
  read_by_name?: string       // resolved display name
  source: string
  notes?: string
  created_at: string
}

export interface MeterReadingCreateRequest {
  unit_id?: string            // omit for property-level readings
  utility_key: string
  current_reading: number
  read_at?: string
  notes?: string
  source?: 'manual' | 'iot'
}

export interface MeterReadingListResponse {
  items: MeterReading[]
  total: number
  page: number
  page_size: number
}
