import client from '@/api/client'
import type { AuthUser } from '@/types/auth'

export interface MeResponse {
  user_id: string
  org_id: string | null
  role: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

export interface LoginResponse {
  token: string
  refresh_token: string
  user: AuthUser
}

export interface SignupPayload {
  email: string
  password: string
  first_name: string
  last_name: string
  org_name: string
}

export interface EmailCheckResult {
  is_disposable: boolean
  risk_score: number
  confidence: string
}

export const authApi = {
  me(): Promise<MeResponse> {
    return client.get<MeResponse>('/auth/me').then((r) => r.data)
  },

  signup(data: SignupPayload): Promise<{ message: string }> {
    return client.post<{ message: string }>('/auth/signup', data).then((r) => r.data)
  },

  verifyOtp(data: { email: string; otp: string }): Promise<LoginResponse> {
    return client.post<LoginResponse>('/auth/signup/verify-otp', data).then((r) => r.data)
  },

  checkEmail(email: string): Promise<EmailCheckResult> {
    return client.post<EmailCheckResult>('/auth/check-email', { email }).then((r) => r.data)
  },

  updateEmail(email: string): Promise<{ is_disposable: boolean; attempts: number; email: string; user: MeResponse }> {
    return client.patch('/auth/me/email', { email }).then((r) => r.data)
  },

  ignoreDisposableEmail(): Promise<{ ok: boolean }> {
    return client.post('/auth/me/email/ignore').then((r) => r.data)
  },
}
