import client from './client'

const BASE = '/framework-portal'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FrameworkSite {
  site_code: string
  site_name: string
  region: string
}

export interface InviteInfo {
  id: string
  name: string
  contact_name: string
  email: string
  specialization?: string
  framework_name: string
  client_name: string
  org_name: string
  status: string
  is_activated: boolean
  available_sites: FrameworkSite[]
}

export interface VendorProfile {
  id: string
  framework_id: string
  org_id: string
  name: string
  contact_name: string
  email: string
  phone?: string
  mobile?: string
  specialization?: string
  regions?: string
  site_codes: string[]
  home_address?: string
  status: 'invited' | 'pending_review' | 'active' | 'suspended'
  has_selfie: boolean
  has_id_front: boolean
  has_id_back: boolean
  has_badge: boolean
  has_cv: boolean
  certificate_count: number
  gps_lat?: number
  gps_lng?: number
  selfie_url?: string
  id_front_url?: string
  id_back_url?: string
  badge_url?: string
  cv_url?: string
  certificate_urls?: string[]
  invited_at: string
  activated_at?: string
}

export interface WorkOrderSummary {
  id: string
  work_order_number: string
  title: string
  service_type: string
  status: string
  planned_date: string
  start_date?: string
  completion_date?: string
  total_assets: number
  route_stops: Array<{
    sequence: number
    site_name: string
    site_code: string
    status: string
    gps_lat?: number
    gps_lng?: number
  }>
  pre_inspection_status?: string
  has_pre_inspection: boolean
}

export interface WorkOrderDetail extends WorkOrderSummary {
  parts_used: Array<{
    part_name: string
    part_number?: string
    quantity: number
    unit_cost: number
    total_cost: number
  }>
  labor_hours?: number
  transport_cost?: number
  accommodation_cost?: number
  report_notes?: string
  pre_inspection?: {
    inspection_date: string
    technician_name: string
    condition_notes: string
    status: string
    estimated_total: number
    items: Array<{
      part_name: string
      part_number?: string
      quantity: number
      estimated_unit_cost: number
      estimated_total_cost: number
      notes?: string
    }>
    approval_notes?: string
  }
}

export interface PortalMetrics {
  summary: {
    total_work_orders: number
    completed: number
    in_progress: number
    pending: number
    cancelled: number
    completion_rate: number
    on_time_rate: number
    pre_inspection_rate: number
  }
  sites: Array<{
    site_code: string
    total_work_orders: number
    completed: number
  }>
  vendor: {
    name: string
    contact_name: string
    specialization?: string
    status: string
    site_codes: string[]
  }
}

// ── Public (no auth) ──────────────────────────────────────────────────────────

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  const res = await client.get<InviteInfo>(`${BASE}/invite/${token}`)
  return res.data
}

export interface ActivatePayload {
  password: string
  mobile: string
  site_codes: string[]
  specialization?: string
  home_address?: string
  gps_lat?: number
  gps_lng?: number
}

export async function activateInvite(token: string, payload: ActivatePayload): Promise<{ token: string; vendor_id: string; status: string; message: string }> {
  const res = await client.post(`${BASE}/invite/${token}/activate`, payload)
  return res.data
}

export async function portalLogin(email: string, password: string): Promise<{ token: string; vendor_id: string; name: string; status: string }> {
  const res = await client.post(`${BASE}/auth/login`, { email, password })
  return res.data
}

export async function requestPortalOtp(email: string): Promise<void> {
  await client.post(`${BASE}/auth/request-otp`, { email })
}

export async function verifyPortalOtp(email: string, otp: string): Promise<{ token: string; vendor_id: string; name: string; status: string }> {
  const res = await client.post(`${BASE}/auth/verify-otp`, { email, otp })
  return res.data
}

export async function uploadInvitePhoto(token: string, photoType: 'selfie' | 'id_front' | 'id_back', file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  await client.post(`${BASE}/invite/${token}/upload/${photoType}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ── Authenticated portal ──────────────────────────────────────────────────────

export async function getMyProfile(): Promise<VendorProfile> {
  const res = await client.get<VendorProfile>(`${BASE}/me`)
  return res.data
}

export async function updateMyProfile(data: Partial<{
  mobile: string
  specialization: string
  site_codes: string[]
  home_address: string
  gps_lat: number
  gps_lng: number
}>): Promise<VendorProfile> {
  const res = await client.patch<VendorProfile>(`${BASE}/me`, data)
  return res.data
}

export async function regenerateBadge(): Promise<{ ok: boolean; badge_url?: string }> {
  const res = await client.post(`${BASE}/me/regenerate-badge`)
  return res.data
}

export interface BadgeVerification {
  valid: boolean
  status: string
  vendor_id: string
  name: string
  company: string
  specialization: string
  site_codes: string[]
  badge_no: string
  org_name: string
  framework_name: string
  contract_end: string
  selfie_url?: string
  active_work_orders: Array<{
    id: string
    work_order_number: string
    title: string
    status: string
    planned_date: string
    sites: string[]
  }>
}

export async function verifyBadge(vendorId: string): Promise<BadgeVerification> {
  const res = await client.get<BadgeVerification>(`${BASE}/verify/${vendorId}`)
  return res.data
}

export async function uploadMyPhoto(photoType: 'selfie' | 'id_front' | 'id_back' | 'cv' | 'certificate', file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  await client.post(`${BASE}/me/upload/${photoType}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export async function listMyWorkOrders(statusFilter?: string): Promise<{ items: WorkOrderSummary[]; total: number }> {
  const res = await client.get(`${BASE}/work-orders`, { params: statusFilter ? { status: statusFilter } : undefined })
  return res.data
}

export async function getMyWorkOrder(id: string): Promise<WorkOrderDetail> {
  const res = await client.get<WorkOrderDetail>(`${BASE}/work-orders/${id}`)
  return res.data
}

export async function respondToWorkOrder(id: string, action: 'accept' | 'start' | 'complete', notes?: string): Promise<WorkOrderSummary> {
  const res = await client.patch<WorkOrderSummary>(`${BASE}/work-orders/${id}/respond`, { action, notes })
  return res.data
}

export interface PreInspectionItem {
  part_name: string
  part_number?: string
  kva_range?: string
  quantity: number
  estimated_unit_cost: number
  notes?: string
}

export async function submitPreInspection(workOrderId: string, data: {
  inspection_date: string
  technician_name: string
  condition_notes: string
  items: PreInspectionItem[]
}): Promise<{ ok: boolean; estimated_total: number; status: string }> {
  const res = await client.post(`${BASE}/work-orders/${workOrderId}/pre-inspection`, data)
  return res.data
}

export async function listMyTickets(): Promise<{ items: Array<{
  id: string
  reference: string
  title: string
  category: string
  status: string
  priority: string
  created_at: string
}>; total: number }> {
  const res = await client.get(`${BASE}/tickets`)
  return res.data
}

export async function getMyMetrics(): Promise<PortalMetrics> {
  const res = await client.get<PortalMetrics>(`${BASE}/metrics`)
  return res.data
}

export async function updateVendorStatus(vendorId: string, status: 'active' | 'suspended' | 'pending_review'): Promise<void> {
  await client.patch(`${BASE}/admin/vendors/${vendorId}/status`, { status })
}
