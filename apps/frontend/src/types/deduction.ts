export type DeductionCategory = 'damage' | 'cleaning' | 'unpaid_rent' | 'other'

export interface Deduction {
  id: string
  org_id: string
  lease_id: string
  tenant_id: string
  category: DeductionCategory
  description: string
  amount: number
  evidence_keys: string[]
  approved_by?: string
  created_at: string
  updated_at: string
}

export interface DeductionSummary {
  items: Deduction[]
  total: number
}

export interface DeductionCreateRequest {
  category: DeductionCategory
  description: string
  amount: number
}
