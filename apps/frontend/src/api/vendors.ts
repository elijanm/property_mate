import apiClient from '@/api/client'
import type {
  VendorProfile,
  VendorProfileListResponse,
  VendorCounts,
  VendorListing,
  VendorListingListResponse,
  VendorApplication,
  VendorApplicationListResponse,
  VendorContract,
  VendorContractListResponse,
  VendorPortalDashboard,
  VendorOnboardingContext,
  VendorSetupContext,
  VendorContractView,
  VendorActivateResponse,
} from '@/types/vendor'

// ── Admin: Vendor Profiles ────────────────────────────────────────────────────

export async function createVendor(data: {
  company_name: string
  contact_name: string
  contact_email: string
  contact_phone?: string
  trading_name?: string
  registration_number?: string
  tax_pin?: string
  company_type?: string
  website?: string
  address?: string
  service_areas?: string[]
  service_categories?: string[]
  notes?: string
}): Promise<VendorProfile> {
  const res = await apiClient.post('/vendors', data)
  return res.data
}

export async function listVendors(params?: {
  status?: string
  category?: string
  search?: string
  page?: number
  page_size?: number
}): Promise<VendorProfileListResponse> {
  const res = await apiClient.get('/vendors', { params })
  return res.data
}

export async function getVendorCounts(): Promise<VendorCounts> {
  const res = await apiClient.get('/vendors/counts')
  return res.data
}

export async function getVendor(id: string): Promise<VendorProfile> {
  const res = await apiClient.get(`/vendors/${id}`)
  return res.data
}

export async function updateVendor(id: string, data: Partial<VendorProfile>): Promise<VendorProfile> {
  const res = await apiClient.patch(`/vendors/${id}`, data)
  return res.data
}

export async function deleteVendor(id: string): Promise<void> {
  await apiClient.delete(`/vendors/${id}`)
}

export async function approveVendor(id: string): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendors/${id}/approve`)
  return res.data
}

export async function suspendVendor(id: string, reason?: string): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendors/${id}/suspend`, { reason })
  return res.data
}

export async function sendVendorInvite(id: string): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendors/${id}/send-invite`)
  return res.data
}

export async function createVendorContract(
  vendorId: string,
  data: {
    title: string
    content: string
    start_date: string
    end_date: string
    auto_renew?: boolean
    renewal_notice_days?: number
    contract_fee?: number
  }
): Promise<VendorContract> {
  const res = await apiClient.post(`/vendors/${vendorId}/contracts`, data)
  return res.data
}

export async function addVendorRating(
  vendorId: string,
  data: { stars: number; review?: string; ticket_id?: string }
): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendors/${vendorId}/rate`, data)
  return res.data
}

export async function getVendorTickets(vendorId: string, params?: { page?: number; page_size?: number }) {
  const res = await apiClient.get(`/vendors/${vendorId}/tickets`, { params })
  return res.data
}

// ── Admin: Vendor Listings ────────────────────────────────────────────────────

export async function createListing(data: {
  title: string
  description: string
  service_category: string
  requirements?: string
  application_fee?: number
  contract_template?: string
  contract_duration_months?: number
  contract_value?: number
  deadline?: string
  max_vendors?: number
}): Promise<VendorListing> {
  const res = await apiClient.post('/vendor-listings', data)
  return res.data
}

export async function listListings(params?: {
  status?: string
  page?: number
  page_size?: number
}): Promise<VendorListingListResponse> {
  const res = await apiClient.get('/vendor-listings', { params })
  return res.data
}

export async function getListing(id: string): Promise<VendorListing> {
  const res = await apiClient.get(`/vendor-listings/${id}`)
  return res.data
}

export async function updateListing(id: string, data: Partial<VendorListing>): Promise<VendorListing> {
  const res = await apiClient.patch(`/vendor-listings/${id}`, data)
  return res.data
}

export async function deleteListing(id: string): Promise<void> {
  await apiClient.delete(`/vendor-listings/${id}`)
}

export async function publishListing(id: string): Promise<VendorListing> {
  const res = await apiClient.post(`/vendor-listings/${id}/publish`)
  return res.data
}

// ── Admin: Vendor Applications ────────────────────────────────────────────────

export async function listApplications(params?: {
  listing_id?: string
  status?: string
  page?: number
  page_size?: number
}): Promise<VendorApplicationListResponse> {
  const res = await apiClient.get('/vendor-applications', { params })
  return res.data
}

export async function getApplication(id: string): Promise<VendorApplication> {
  const res = await apiClient.get(`/vendor-applications/${id}`)
  return res.data
}

export async function approveApplication(id: string): Promise<VendorApplication> {
  const res = await apiClient.post(`/vendor-applications/${id}/approve`)
  return res.data
}

export async function rejectApplication(id: string, rejection_reason: string): Promise<VendorApplication> {
  const res = await apiClient.post(`/vendor-applications/${id}/reject`, { rejection_reason })
  return res.data
}

// ── Public: Listings + Applications ──────────────────────────────────────────

export async function getPublicListingsDirectory(orgId: string) {
  const res = await apiClient.get('/vendor-listings/public', { params: { org_id: orgId } })
  return res.data as {
    org: { org_id: string; name: string; logo_url?: string; email?: string; phone?: string; website?: string; address?: string }
    listings: VendorListing[]
  }
}

export async function getPublicListing(listingId: string) {
  const res = await apiClient.get(`/vendor-listings/${listingId}/public`)
  return res.data
}

export async function applyToListing(
  listingId: string,
  data: {
    company_name: string
    contact_name: string
    contact_email: string
    contact_phone?: string
    registration_number?: string
    tax_pin?: string
    service_categories?: string[]
    cover_letter?: string
  }
) {
  const res = await apiClient.post(`/vendor-listings/${listingId}/apply`, data)
  return res.data
}

// ── Public: Onboarding ────────────────────────────────────────────────────────

export async function getOnboardingContext(token: string): Promise<VendorOnboardingContext> {
  const res = await apiClient.get(`/vendor-onboarding/${token}`)
  return res.data
}

export async function saveCompanyDetails(token: string, data: object): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendor-onboarding/${token}/company`, data)
  return res.data
}

export async function saveServices(
  token: string,
  data: { service_categories: string[]; services: object[] }
): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendor-onboarding/${token}/services`, data)
  return res.data
}

export async function uploadVendorDocument(
  token: string,
  doc_type: string,
  name: string,
  file: File
): Promise<{ id: string; doc_type: string; name: string; s3_key: string }> {
  const form = new FormData()
  form.append('doc_type', doc_type)
  form.append('name', name)
  form.append('file', file)
  const res = await apiClient.post(`/vendor-onboarding/${token}/documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function completeOnboarding(token: string): Promise<VendorProfile> {
  const res = await apiClient.post(`/vendor-onboarding/${token}/complete`)
  return res.data
}

// ── Public: Contract ──────────────────────────────────────────────────────────

export async function getContractView(token: string): Promise<VendorContractView> {
  const res = await apiClient.get(`/vendor-contracts/${token}/view`)
  return res.data
}

export async function signContract(
  token: string,
  data: { signature_base64: string; signer_name: string }
): Promise<VendorContract> {
  const res = await apiClient.post(`/vendor-contracts/${token}/sign`, data)
  return res.data
}

// ── Public: Account Setup ─────────────────────────────────────────────────────

export async function getSetupContext(token: string): Promise<VendorSetupContext> {
  const res = await apiClient.get(`/vendor-setup/${token}`)
  return res.data
}

export async function activateVendorAccount(
  token: string,
  password: string
): Promise<VendorActivateResponse> {
  const res = await apiClient.post(`/vendor-setup/${token}/activate`, { password })
  return res.data
}

// ── Vendor Portal (service_provider role) ─────────────────────────────────────

export async function getPortalDashboard(): Promise<VendorPortalDashboard> {
  const res = await apiClient.get('/vendor-portal/dashboard')
  return res.data
}

export async function getPortalProfile(): Promise<VendorProfile> {
  const res = await apiClient.get('/vendor-portal/profile')
  return res.data
}

export async function updatePortalProfile(data: Partial<VendorProfile>): Promise<VendorProfile> {
  const res = await apiClient.patch('/vendor-portal/profile', data)
  return res.data
}

export async function getPortalContracts(params?: {
  page?: number
  page_size?: number
}): Promise<VendorContractListResponse> {
  const res = await apiClient.get('/vendor-portal/contracts', { params })
  return res.data
}

export async function getPortalContract(id: string): Promise<VendorContract> {
  const res = await apiClient.get(`/vendor-portal/contracts/${id}`)
  return res.data
}

export async function getPortalTickets(params?: {
  status?: string
  page?: number
  page_size?: number
}) {
  const res = await apiClient.get('/vendor-portal/tickets', { params })
  return res.data
}
