import client from './client'
import type {
  FrameworkContract,
  FrameworkAsset,
  MaintenanceSchedule,
  WorkOrder,
  SlaRecord,
  SparePartsPricing,
  SparePartsKit,
  RateSchedule,
  TransportCostEntry,
  FrameworkStats,
  FrameworkCreateRequest,
  FrameworkAssetCreateRequest,
} from '@/types/framework'
import type { PaginatedResponse } from '@/types/api'

// ── Framework Contracts ──────────────────────────────────────────

export async function listFrameworks(): Promise<FrameworkContract[]> {
  try {
    const res = await client.get<FrameworkContract[]>('/frameworks')
    return res.data
  } catch {
    return []
  }
}

export async function getFramework(id: string): Promise<FrameworkContract | null> {
  try {
    const res = await client.get<FrameworkContract>(`/frameworks/${id}`)
    return res.data
  } catch {
    return null
  }
}

export async function createFramework(data: FrameworkCreateRequest): Promise<FrameworkContract> {
  const res = await client.post<FrameworkContract>('/frameworks', data)
  return res.data
}

export async function updateFramework(id: string, data: Partial<FrameworkCreateRequest>): Promise<FrameworkContract> {
  const res = await client.patch<FrameworkContract>(`/frameworks/${id}`, data)
  return res.data
}

export async function deleteFramework(id: string): Promise<void> {
  await client.delete(`/frameworks/${id}`)
}

// ── Framework Stats ──────────────────────────────────────────────

export async function getFrameworkStats(frameworkId: string): Promise<FrameworkStats> {
  try {
    const res = await client.get<FrameworkStats>(`/frameworks/${frameworkId}/stats`)
    return res.data
  } catch {
    return {
      total_assets: 0, operational: 0, under_maintenance: 0, fault: 0,
      decommissioned: 0, overdue_schedules: 0, open_work_orders: 0,
      completed_this_month: 0, avg_sla_score: 100, total_penalties_qtd: 0,
    }
  }
}

// ── Framework Assets ─────────────────────────────────────────────

export async function listFrameworkAssets(
  frameworkId: string,
  params?: { search?: string; region?: string; status?: string; kva?: string; page?: number }
): Promise<PaginatedResponse<FrameworkAsset>> {
  try {
    const res = await client.get<PaginatedResponse<FrameworkAsset>>(`/frameworks/${frameworkId}/assets`, { params })
    return res.data
  } catch {
    return { items: [], total: 0, page: 1, page_size: 20 } as unknown as PaginatedResponse<FrameworkAsset>
  }
}

export async function getFrameworkAsset(frameworkId: string, assetId: string): Promise<FrameworkAsset> {
  const res = await client.get<FrameworkAsset>(`/frameworks/${frameworkId}/assets/${assetId}`)
  return res.data
}

export async function createFrameworkAsset(
  frameworkId: string,
  data: FrameworkAssetCreateRequest
): Promise<FrameworkAsset> {
  const res = await client.post<FrameworkAsset>(`/frameworks/${frameworkId}/assets`, data)
  return res.data
}

export async function updateFrameworkAsset(
  frameworkId: string,
  assetId: string,
  data: Partial<FrameworkAssetCreateRequest>
): Promise<FrameworkAsset> {
  const res = await client.patch<FrameworkAsset>(`/frameworks/${frameworkId}/assets/${assetId}`, data)
  return res.data
}

export async function deleteFrameworkAsset(frameworkId: string, assetId: string): Promise<void> {
  await client.delete(`/frameworks/${frameworkId}/assets/${assetId}`)
}

// ── Maintenance Schedules ────────────────────────────────────────

export async function listSchedules(
  frameworkId: string,
  params?: { month?: string; status?: string; asset_id?: string }
): Promise<MaintenanceSchedule[]> {
  try {
    const res = await client.get<MaintenanceSchedule[]>(`/frameworks/${frameworkId}/schedules`, { params })
    return res.data
  } catch {
    return []
  }
}

export async function createSchedule(
  frameworkId: string,
  data: Omit<MaintenanceSchedule, 'id' | 'org_id' | 'framework_id' | 'created_at'>
): Promise<MaintenanceSchedule> {
  const res = await client.post<MaintenanceSchedule>(`/frameworks/${frameworkId}/schedules`, data)
  return res.data
}

export async function updateScheduleStatus(
  frameworkId: string,
  scheduleId: string,
  status: string
): Promise<MaintenanceSchedule> {
  const res = await client.patch<MaintenanceSchedule>(`/frameworks/${frameworkId}/schedules/${scheduleId}`, { status })
  return res.data
}

// ── Work Orders ──────────────────────────────────────────────────

export async function listWorkOrders(
  frameworkId: string,
  params?: { status?: string; page?: number }
): Promise<PaginatedResponse<WorkOrder>> {
  try {
    const res = await client.get<PaginatedResponse<WorkOrder>>(`/frameworks/${frameworkId}/work-orders`, { params })
    return res.data
  } catch {
    return { items: [], total: 0, page: 1, page_size: 20 } as unknown as PaginatedResponse<WorkOrder>
  }
}

export async function getWorkOrder(frameworkId: string, workOrderId: string): Promise<WorkOrder> {
  const res = await client.get<WorkOrder>(`/frameworks/${frameworkId}/work-orders/${workOrderId}`)
  return res.data
}

export async function createWorkOrder(
  frameworkId: string,
  data: Partial<WorkOrder>
): Promise<WorkOrder> {
  const res = await client.post<WorkOrder>(`/frameworks/${frameworkId}/work-orders`, data)
  return res.data
}

export async function updateWorkOrder(
  frameworkId: string,
  workOrderId: string,
  data: Partial<WorkOrder>
): Promise<WorkOrder> {
  const res = await client.patch<WorkOrder>(`/frameworks/${frameworkId}/work-orders/${workOrderId}`, data)
  return res.data
}

export async function generateRoute(
  frameworkId: string,
  assetIds: string[],
  startLat?: number,
  startLng?: number
): Promise<WorkOrder> {
  const res = await client.post<WorkOrder>(`/frameworks/${frameworkId}/work-orders/generate-route`, {
    asset_ids: assetIds,
    start_lat: startLat,
    start_lng: startLng,
  })
  return res.data
}

// ── SLA Records ──────────────────────────────────────────────────

export async function listSlaRecords(
  frameworkId: string,
  params?: { period?: string; asset_id?: string }
): Promise<SlaRecord[]> {
  try {
    const res = await client.get<SlaRecord[]>(`/frameworks/${frameworkId}/sla`, { params })
    return res.data
  } catch {
    return []
  }
}

export async function getSlaRecord(frameworkId: string, slaId: string): Promise<SlaRecord> {
  const res = await client.get<SlaRecord>(`/frameworks/${frameworkId}/sla/${slaId}`)
  return res.data
}

// ── Spare Parts Pricing ──────────────────────────────────────────

export async function listSparePartsPricing(frameworkId: string): Promise<SparePartsPricing[]> {
  try {
    const res = await client.get<SparePartsPricing[]>(`/frameworks/${frameworkId}/spare-parts`)
    return res.data
  } catch {
    return []
  }
}

export async function upsertSparePartPricing(
  frameworkId: string,
  data: Omit<SparePartsPricing, 'id' | 'org_id' | 'framework_id'>
): Promise<SparePartsPricing> {
  const res = await client.post<SparePartsPricing>(`/frameworks/${frameworkId}/spare-parts`, data)
  return res.data
}

// ── Transport Costs ──────────────────────────────────────────────

export async function listTransportCosts(frameworkId: string): Promise<TransportCostEntry[]> {
  try {
    const res = await client.get<TransportCostEntry[]>(`/frameworks/${frameworkId}/transport-costs`)
    return res.data
  } catch {
    return []
  }
}

export async function upsertTransportCost(
  frameworkId: string,
  data: Omit<TransportCostEntry, 'id' | 'org_id' | 'framework_id'>
): Promise<TransportCostEntry> {
  const res = await client.post<TransportCostEntry>(`/frameworks/${frameworkId}/transport-costs`, data)
  return res.data
}

// ── Regions & Sites ───────────────────────────────────────────────────────────

export interface RegionsSitesPayload {
  regions: string[]
  sites: Array<{
    site_code: string
    site_name: string
    region: string
    physical_address?: string
    gps_lat?: number
    gps_lng?: number
    contact_name?: string
    contact_phone?: string
    notes?: string
  }>
}

export async function updateRegionsSites(frameworkId: string, data: RegionsSitesPayload): Promise<FrameworkContract> {
  const res = await client.put<FrameworkContract>(`/frameworks/${frameworkId}/regions-sites`, data)
  return res.data
}

// ── Schedule 4 ────────────────────────────────────────────────────────────────

export interface Schedule4EntryPayload {
  site_code?: string
  site_name: string
  region: string
  brand?: string
  kva_rating?: string
  cost_a: number
  cost_b: number
  cost_c: number
  notes?: string
}

export async function updateSchedule4(
  frameworkId: string,
  entries: Schedule4EntryPayload[],
): Promise<FrameworkContract> {
  const res = await client.put<FrameworkContract>(`/frameworks/${frameworkId}/schedule4`, { entries })
  return res.data
}

// ── Spare Parts Kits ─────────────────────────────────────────────────────────

export interface SparePartsKitCreatePayload {
  kit_name: string
  validity_type?: string
  engine_make?: string
  engine_model?: string
  kva_min?: number
  kva_max?: number
  applicable_service_types?: string[]
  site_code?: string
  items: Array<{
    part_number?: string
    part_name: string
    quantity: number
    unit?: string
    unit_price?: number
    notes?: string
  }>
  notes?: string
}

export async function listPartsKits(frameworkId: string): Promise<SparePartsKit[]> {
  try {
    const res = await client.get<SparePartsKit[]>(`/frameworks/${frameworkId}/parts-kits`)
    return res.data
  } catch {
    return []
  }
}

export async function createPartsKit(frameworkId: string, data: SparePartsKitCreatePayload): Promise<SparePartsKit> {
  const res = await client.post<SparePartsKit>(`/frameworks/${frameworkId}/parts-kits`, data)
  return res.data
}

export async function updatePartsKit(frameworkId: string, kitId: string, data: Partial<SparePartsKitCreatePayload>): Promise<SparePartsKit> {
  const res = await client.patch<SparePartsKit>(`/frameworks/${frameworkId}/parts-kits/${kitId}`, data)
  return res.data
}

export async function deletePartsKit(frameworkId: string, kitId: string): Promise<void> {
  await client.delete(`/frameworks/${frameworkId}/parts-kits/${kitId}`)
}

// ── Rate Schedules ────────────────────────────────────────────────────────────

export interface RateSchedulePayload {
  pricing_tier: 'A' | 'B' | 'C'
  effective_date: string
  expiry_date?: string
  is_active?: boolean
  labour_rates?: Array<{ role: string; rate_per_day: number; rate_per_hour?: number; notes?: string }>
  accommodation_rates?: Array<{ region: string; rate_per_day: number; notes?: string }>
  personnel_transport_rates?: Array<{ region: string; transport_mode: string; rate_per_km?: number; fixed_rate?: number; notes?: string }>
  generator_transport_rates?: Array<{ region: string; description?: string; rate_per_km?: number; fixed_rate?: number; notes?: string }>
  site_overrides?: Array<{ site_code: string; site_name: string; multiplier?: number; notes?: string }>
  notes?: string
}

export async function listRateSchedules(frameworkId: string): Promise<RateSchedule[]> {
  try {
    const res = await client.get<RateSchedule[]>(`/frameworks/${frameworkId}/rate-schedules`)
    return res.data
  } catch {
    return []
  }
}

export async function upsertRateSchedule(frameworkId: string, data: RateSchedulePayload): Promise<RateSchedule> {
  const res = await client.put<RateSchedule>(`/frameworks/${frameworkId}/rate-schedules`, data)
  return res.data
}

// ── Invited Vendors ──────────────────────────────────────────────

export interface InvitedVendor {
  id: string
  framework_id: string
  name: string
  contact_name: string
  email: string
  phone?: string
  mobile?: string
  specialization?: string
  regions?: string
  site_codes: string[]
  status: string
  gps_lat?: number
  gps_lng?: number
  invited_at: string
  reinvited_at?: string
  activated_at?: string
  portal_token?: string
}

export interface InviteVendorPayload {
  name: string
  contact_name: string
  email: string
  phone?: string
  specialization?: string
  regions?: string
}

export async function listInvitedVendors(frameworkId: string): Promise<InvitedVendor[]> {
  try {
    const res = await client.get<InvitedVendor[]>(`/frameworks/${frameworkId}/invited-vendors`)
    return res.data
  } catch {
    return []
  }
}

export async function inviteVendor(frameworkId: string, data: InviteVendorPayload): Promise<InvitedVendor> {
  const res = await client.post<InvitedVendor>(`/frameworks/${frameworkId}/invited-vendors`, data)
  return res.data
}

export async function reinviteVendor(frameworkId: string, memberId: string): Promise<InvitedVendor> {
  const res = await client.post<InvitedVendor>(`/frameworks/${frameworkId}/invited-vendors/${memberId}/reinvite`)
  return res.data
}

export async function removeInvitedVendor(frameworkId: string, memberId: string): Promise<void> {
  await client.delete(`/frameworks/${frameworkId}/invited-vendors/${memberId}`)
}

export interface VendorDocs {
  has_selfie: boolean
  has_id_front: boolean
  has_id_back: boolean
  has_badge: boolean
  selfie_url?: string
  id_front_url?: string
  id_back_url?: string
  badge_url?: string
  status: string
  activated_at?: string
  gps_lat?: number
  gps_lng?: number
  mobile?: string
  site_codes: string[]
}

export async function getVendorDocs(frameworkId: string, memberId: string): Promise<VendorDocs> {
  const res = await client.get<VendorDocs>(`/frameworks/${frameworkId}/invited-vendors/${memberId}/docs`)
  return res.data
}

// ── Pre-Inspection ───────────────────────────────────────────────

export interface PreInspectionItemPayload {
  part_name: string
  part_number?: string
  kva_range?: string
  quantity: number
  estimated_unit_cost: number
  notes?: string
}

export async function submitPreInspection(
  frameworkId: string,
  workOrderId: string,
  data: {
    inspection_date: string
    technician_name: string
    condition_notes: string
    items: PreInspectionItemPayload[]
  }
): Promise<WorkOrder> {
  const res = await client.post<WorkOrder>(
    `/frameworks/${frameworkId}/work-orders/${workOrderId}/pre-inspection`,
    data
  )
  return res.data
}

export async function reviewPreInspection(
  frameworkId: string,
  workOrderId: string,
  approved: boolean,
  approval_notes?: string
): Promise<WorkOrder> {
  const res = await client.patch<WorkOrder>(
    `/frameworks/${frameworkId}/work-orders/${workOrderId}/pre-inspection/review`,
    { approved, approval_notes }
  )
  return res.data
}

// ── PDF Extraction ───────────────────────────────────────────────

export interface ExtractedContract {
  name: string
  client_name: string
  contract_number: string
  contract_start: string
  contract_end: string
  region: string
  description: string
  confidence: 'high' | 'medium' | 'low'
  raw_text_preview: string
}

export async function extractContractPdf(file: File): Promise<ExtractedContract> {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post<ExtractedContract>('/frameworks/extract-pdf', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
