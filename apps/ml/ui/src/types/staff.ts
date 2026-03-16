export interface Contributor {
  email: string
  full_name: string
  country: string
  county: string
  phone_number: string
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected'
  total_points_earned: number
  total_points_redeemed: number
  redeemable_points: number
  total_entries_submitted: number
  total_tasks_completed: number
  joined_at: string
  last_active_at: string | null
  is_active: boolean
  referral_code: string
}

export interface StaffMember {
  id: string
  email: string
  full_name: string
  role: 'viewer' | 'engineer' | 'admin'
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export interface StaffInvitePayload {
  email: string
  role: string
  full_name: string
}

export interface PlanStaffInfo {
  current_count: number
  max_allowed: number   // -1 = unlimited, 0 = disabled
  can_invite: boolean
  reason: string
}
