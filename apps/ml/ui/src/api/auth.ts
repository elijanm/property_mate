import client from './client'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: { email: string; full_name: string; role: string; org_id: string; is_onboarded: boolean }
}

export interface RegisterResponse {
  email: string
  full_name: string
  role: string
  pending_verification: boolean
}

export const authApi = {
  login: (email: string, password: string) =>
    client.post<LoginResponse>('/auth/login', { email, password }).then(r => r.data),

  register: (email: string, password: string, full_name = '', coupon_code = '') =>
    client.post<RegisterResponse>('/auth/register', { email, password, full_name, coupon_code: coupon_code || undefined }).then(r => r.data),

  verifyOtp: (email: string, otp: string) =>
    client.post<{ verified: boolean; email: string }>('/auth/verify', { email, otp }).then(r => r.data),

  verifyToken: (token: string) =>
    client.get<{ verified: boolean; email: string }>(`/auth/verify/${token}`).then(r => r.data),

  resendVerification: (email: string) =>
    client.post<{ sent: boolean }>('/auth/resend-verification', { email }).then(r => r.data),

  refresh: (refresh_token: string) =>
    client.post<{ access_token: string }>('/auth/refresh', { refresh_token }).then(r => r.data),

  me: () => client.get('/auth/me').then(r => r.data),

  forgotPassword: (email: string) =>
    client.post<{ ok: boolean }>('/auth/forgot-password', { email }).then(r => r.data),

  resetPassword: (token: string, new_password: string) =>
    client.post<{ ok: boolean }>('/auth/reset-password', { token, new_password }).then(r => r.data),

  requestSecurityOtp: (action = 'change your password') =>
    client.post<{ ok: boolean; message: string }>('/auth/request-security-otp', { action }).then(r => r.data),

  changePassword: (current_password: string, new_password: string, otp = '') =>
    client.post<{ ok: boolean }>('/auth/change-password', { current_password, new_password, otp }).then(r => r.data),

  registerWithInvite: (email: string, password: string, fullName: string, inviteToken: string) =>
    client.post('/auth/register-invite', { email, password, full_name: fullName, invite_token: inviteToken }).then(r => r.data),

  updateProfile: (data: { full_name?: string; role?: string; is_onboarded?: boolean }) =>
    client.patch('/auth/profile', data).then(r => r.data),

  validateCoupon: (code: string) =>
    client.get<{ valid: boolean; credit_usd?: number; code?: string; error?: string }>(`/auth/validate-coupon`, { params: { code } }).then(r => r.data),

  checkEmail: (email: string) =>
    client.post<{ is_disposable: boolean; risk_score: number; confidence: string }>('/auth/check-email', { email }).then(r => r.data),

  updateEmail: (email: string) =>
    client.patch<{ is_disposable: boolean; attempts: number; email: string }>('/auth/me/email', { email }).then(r => r.data),

  ignoreDisposableEmail: () =>
    client.post<{ ok: boolean }>('/auth/me/email/ignore').then(r => r.data),
}
