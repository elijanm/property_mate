// ── Vendor Profile ────────────────────────────────────────────────────────────

export type VendorStatus = 'draft' | 'pending_review' | 'approved' | 'suspended' | 'inactive' | 'rejected';
export type VendorVerificationStatus = 'unverified' | 'in_review' | 'verified' | 'failed';
export type VendorCompanyType = 'individual' | 'sole_proprietor' | 'partnership' | 'limited_company';

export interface VendorServiceOffering {
  id: string;
  name: string;
  category: string;
  description?: string;
  base_rate?: number;
  rate_unit?: string;
  availability?: string;
}

export interface VendorDocument {
  id: string;
  doc_type: string;
  name: string;
  s3_key: string;
  url?: string;
  uploaded_at: string;
  expires_at?: string;
  verified: boolean;
}

export interface VendorTeamMember {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
}

export interface VendorRating {
  id: string;
  rated_by: string;
  rated_by_name?: string;
  stars: number;
  review?: string;
  ticket_id?: string;
  created_at: string;
}

export interface VendorProfile {
  id: string;
  org_id: string;
  user_id?: string;
  status: VendorStatus;
  verification_status: VendorVerificationStatus;
  company_name: string;
  trading_name?: string;
  registration_number?: string;
  tax_pin?: string;
  company_type: VendorCompanyType;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  website?: string;
  address?: string;
  service_areas: string[];
  service_categories: string[];
  active_contract_id?: string;
  rating_avg: number;
  rating_count: number;
  notes?: string;
  onboarding_completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface VendorProfileListResponse {
  items: VendorProfile[];
  total: number;
  page: number;
  page_size: number;
}

export interface VendorCounts {
  total: number;
  approved: number;
  pending_review: number;
  suspended: number;
  draft: number;
  inactive: number;
  rejected: number;
}

// ── Vendor Listing ────────────────────────────────────────────────────────────

export type VendorListingStatus = 'draft' | 'open' | 'closed' | 'awarded';

export interface VendorListing {
  id: string;
  org_id: string;
  title: string;
  description: string;
  service_category: string;
  requirements?: string;
  application_fee: number;
  contract_template?: string;
  contract_duration_months?: number;
  contract_value?: number;
  deadline?: string;
  max_vendors?: number;
  status: VendorListingStatus;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

export interface VendorListingListResponse {
  items: VendorListing[];
  total: number;
  page: number;
  page_size: number;
}

// ── Vendor Application ────────────────────────────────────────────────────────

export type VendorApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

export interface VendorApplication {
  id: string;
  org_id: string;
  listing_id?: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  registration_number?: string;
  tax_pin?: string;
  service_categories: string[];
  cover_letter?: string;
  fee_paid: boolean;
  fee_amount: number;
  status: VendorApplicationStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  vendor_profile_id?: string;
  created_at: string;
  updated_at: string;
}

export interface VendorApplicationListResponse {
  items: VendorApplication[];
  total: number;
  page: number;
  page_size: number;
}

// ── Vendor Contract ───────────────────────────────────────────────────────────

export type VendorContractStatus = 'draft' | 'sent' | 'vendor_signed' | 'org_signed' | 'active' | 'expired' | 'terminated';

export interface ContractSignature {
  signed_by: string;
  signed_by_name: string;
  signed_at: string;
  ip_address?: string;
}

export interface VendorContract {
  id: string;
  org_id: string;
  vendor_profile_id: string;
  listing_id?: string;
  title: string;
  content: string;
  start_date: string;
  end_date: string;
  auto_renew: boolean;
  renewal_notice_days: number;
  contract_fee: number;
  fee_paid: boolean;
  status: VendorContractStatus;
  vendor_signature?: ContractSignature;
  org_signature?: ContractSignature;
  sent_at?: string;
  activated_at?: string;
  terminated_at?: string;
  termination_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface VendorContractListResponse {
  items: VendorContract[];
  total: number;
  page: number;
  page_size: number;
}

// ── Portal dashboard ──────────────────────────────────────────────────────────

export interface VendorPortalDashboard {
  open_tickets: number;
  active_contracts: number;
  pending_documents: number;
  total_ratings: number;
  rating_avg: number;
}

// ── Public onboarding ─────────────────────────────────────────────────────────

export interface VendorOnboardingContext {
  vendor_profile_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  status: string;
  onboarding_completed_at?: string;
}

export interface VendorSetupContext {
  company_name: string;
  contact_name: string;
  contact_email: string;
}

export interface VendorContractView {
  id: string;
  title: string;
  content: string;
  status: string;
  vendor_profile_id: string;
  company_name: string;
  start_date: string;
  end_date: string;
  vendor_signature?: ContractSignature;
}

export interface VendorActivateResponse {
  token: string;
  user_id: string;
  org_id?: string;
  role: string;
  email: string;
}
