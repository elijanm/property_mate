export type LeaseStatus = 'draft' | 'pending_payment' | 'pending_signature' | 'active' | 'expired' | 'terminated'

export interface LeaseDiscount {
  id: string
  label: string
  type: 'fixed' | 'percentage'
  value: number
  effective_from: string
  effective_to?: string
  note?: string
  recorded_by: string
  created_at: string
  effective_rent: number
  discount_amount: number
}

export interface LeaseDiscountPayload {
  label: string
  type: 'fixed' | 'percentage'
  value: number
  effective_from: string
  effective_to?: string
  note?: string
}

export interface RentEscalation {
  id: string
  effective_date: string
  new_rent_amount: number
  percentage_increase?: number
  applied: boolean
  applied_at?: string
  note?: string
  created_by: string
  created_at: string
}

export interface EarlyTerminationTerms {
  penalty_type: 'months' | 'fixed'
  penalty_value: number
  notice_days: number
  note?: string
  penalty_amount: number
}

export interface RenewalOffer {
  id: string
  new_rent_amount: number
  new_end_date?: string
  message?: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  sent_at: string
  responded_at?: string
  created_by: string
}

export interface CoTenant {
  id: string
  role: 'co_tenant' | 'guarantor'
  first_name: string
  last_name: string
  email?: string
  phone?: string
  id_type?: string
  id_number?: string
  added_at: string
  added_by: string
}

export interface LeaseNote {
  id: string
  body: string
  is_private: boolean
  created_by: string
  created_at: string
}

export interface TenantRating {
  score: number
  payment_timeliness: number
  property_care: number
  communication: number
  note?: string
  rated_by: string
  rated_at: string
}

export interface TenantCreateInline {
  email: string
  first_name: string
  last_name: string
  phone?: string
  password: string
}

export interface Lease {
  id: string
  reference_no: string
  org_id: string
  property_id: string
  unit_id: string
  unit_code?: string              // denormalised from Unit
  tenant_id: string
  onboarding_id?: string
  onboarding_token?: string       // present only on create response
  status: LeaseStatus
  start_date: string
  end_date?: string
  rent_amount: number
  deposit_amount: number
  utility_deposit?: number
  unit_utility_deposits: number   // sum of utility_overrides[*].deposit
  notes?: string
  signed_at?: string
  activated_at?: string
  terminated_at?: string
  created_at: string
  updated_at: string
  discounts: LeaseDiscount[]
  effective_rent: number
  discount_amount: number
  escalations: RentEscalation[]
  early_termination?: EarlyTerminationTerms
  renewal_offer?: RenewalOffer
  co_tenants: CoTenant[]
  notes_internal: LeaseNote[]
  rating?: TenantRating
}

export interface LeaseCreateRequest {
  unit_id: string
  tenant_id?: string
  tenant_create?: TenantCreateInline
  onboarding_id?: string
  start_date: string
  end_date?: string
  rent_amount: number
  deposit_amount: number
  utility_deposit?: number
  notes?: string
}
