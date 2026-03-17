import client from './client'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: { email: string; full_name: string; role: string; org_id: string }
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

  register: (email: string, password: string, full_name = '') =>
    client.post<RegisterResponse>('/auth/register', { email, password, full_name }).then(r => r.data),

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

  changePassword: (current_password: string, new_password: string) =>
    client.post<{ ok: boolean }>('/auth/change-password', { current_password, new_password }).then(r => r.data),

  registerWithInvite: (email: string, password: string, fullName: string, inviteToken: string) =>
    client.post('/auth/register-invite', { email, password, full_name: fullName, invite_token: inviteToken }).then(r => r.data),
}
