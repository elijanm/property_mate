import client from './client'
import type { MfaStatus, MfaSetupResponse, MfaVerifyResponse, MfaUserStatus } from '@/types/mfa'

export const mfaApi = {
  getStatus: () =>
    client.get<MfaStatus>('/auth/mfa/status').then((r) => r.data),

  setup: () =>
    client.post<MfaSetupResponse>('/auth/mfa/setup').then((r) => r.data),

  confirm: (code: string) =>
    client.post<{ ok: boolean }>('/auth/mfa/setup/confirm', { code }).then((r) => r.data),

  verify: (code: string) =>
    client.post<MfaVerifyResponse>('/auth/mfa/verify', { code }).then((r) => r.data),

  listUsers: () =>
    client.get<MfaUserStatus[]>('/mfa/users').then((r) => r.data),

  revokeUser: (userId: string) =>
    client.post<{ ok: boolean }>(`/mfa/users/${userId}/revoke`).then((r) => r.data),
}
