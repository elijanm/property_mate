export interface LeaseTemplate {
  id: string
  org_id: string
  name: string
  description?: string
  rent_amount: number
  deposit_amount: number
  deposit_rule: string
  utility_deposit?: number
  utilities: object[]
  early_termination_penalty_type: string
  early_termination_penalty_value: number
  notice_days: number
  additional_clauses?: string
  created_by: string
  created_at: string
  updated_at: string
}
