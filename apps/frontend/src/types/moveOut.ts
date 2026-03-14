export interface ChecklistItem {
  id: string
  label: string
  category: 'general' | 'cleaning' | 'maintenance' | 'utilities'
  checked: boolean
  notes?: string
  photo_key?: string
  checked_by?: string
  checked_at?: string
}

export interface DamageItem {
  id: string
  description: string
  location: string
  severity: 'minor' | 'moderate' | 'major'
  estimated_cost: number
  photo_keys: string[]
  deduct_from_deposit: boolean
  assessed_by?: string
  assessed_at?: string
}

export interface MoveOutInspection {
  id: string
  org_id: string
  lease_id: string
  property_id: string
  unit_id: string
  tenant_id: string
  status: 'pending' | 'in_progress' | 'completed' | 'approved'
  scheduled_date?: string
  completed_date?: string
  inspector_id?: string
  checklist: ChecklistItem[]
  damages: DamageItem[]
  total_damage_cost: number
  deposit_deduction: number
  net_deposit_refund: number
  inspector_notes?: string
  approved_by?: string
  approved_at?: string
  reconciliation_pdf_key?: string
  created_at: string
  updated_at: string
}
