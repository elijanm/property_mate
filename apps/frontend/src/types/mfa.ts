export interface MfaStatus {
  enrolled: boolean
  enrolled_at?: string
}

export interface MfaSetupResponse {
  qr_uri: string
  secret: string
}

export interface MfaVerifyResponse {
  valid: boolean
  session_token?: string
  expires_in?: number
}

export interface MfaUserStatus {
  user_id: string
  email: string
  first_name: string
  last_name: string
  role: string
  enrolled: boolean
  enrolled_at?: string
  last_verified_at?: string
}

export interface OnboardingDocuments {
  onboarding_id: string
  status: string
  id_front_url?: string
  id_back_url?: string
  selfie_url?: string
  signature_url?: string
  signed_at?: string
  id_type?: string
  id_number?: string
  first_name?: string
  last_name?: string
  date_of_birth?: string
  phone?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
}
