export type InspectionType = 'pre_move_in' | 'move_out'

export type InspectionStatus = 'pending' | 'submitted' | 'reviewed'

export interface MeterReading {
  utility_key: string
  utility_label: string
  reading: number
  unit_label: string
  photo_url?: string
}

export interface DefectItem {
  id: string
  location: string
  description: string
  photo_urls: string[]
}

export interface InspectionReport {
  id: string
  org_id?: string
  lease_id: string
  property_id?: string
  unit_id?: string
  tenant_id?: string
  type: InspectionType
  status: InspectionStatus
  token?: string
  meter_readings: MeterReading[]
  defects: DefectItem[]
  official_meter_readings?: MeterReading[]
  expires_at?: string
  window_days?: number
  submitted_at?: string
  reviewed_at?: string
  reviewed_by?: string
  notes?: string
  created_at: string
  updated_at?: string
}

export interface InspectionCreateRequest {
  type: InspectionType
  notes?: string
}
