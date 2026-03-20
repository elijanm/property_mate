import client from './client'
import type { OrgWatermarkConfig, UserWatermarkConfig } from '@/types/watermark'

export const watermarkApi = {
  // ── Org admin ─────────────────────────────────────────────────────────────
  getOrgConfig: () =>
    client.get<OrgWatermarkConfig>('/watermark/org').then(r => r.data),

  uploadOrgWatermark: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post<OrgWatermarkConfig>('/watermark/org/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  updateOrgSettings: (settings: {
    position?: string
    opacity?: number
    scale?: number
    active?: boolean
    allow_user_override?: boolean
    allowed_plans?: string[]
  }) =>
    client.patch<OrgWatermarkConfig>('/watermark/org', settings).then(r => r.data),

  deleteOrgWatermarkImage: () =>
    client.delete<{ ok: boolean }>('/watermark/org/image').then(r => r.data),

  // ── User override management ───────────────────────────────────────────────
  listUserOverrides: () =>
    client.get<UserWatermarkConfig[]>('/watermark/org/users').then(r => r.data),

  grantUserOverride: (userId: string) =>
    client.post<UserWatermarkConfig>(`/watermark/org/users/${userId}/grant`).then(r => r.data),

  revokeUserOverride: (userId: string) =>
    client.delete<{ ok: boolean }>(`/watermark/org/users/${userId}/revoke`).then(r => r.data),

  // ── Per-user (engineer) ───────────────────────────────────────────────────
  getMyConfig: () =>
    client.get<UserWatermarkConfig & { has_config: boolean }>('/watermark/me').then(r => r.data),

  uploadMyWatermark: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post<UserWatermarkConfig>('/watermark/me/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  updateMySettings: (settings: { position?: string; opacity?: number; scale?: number; active?: boolean }) =>
    client.patch<UserWatermarkConfig>('/watermark/me', settings).then(r => r.data),

  deleteMyWatermarkImage: () =>
    client.delete<{ ok: boolean }>('/watermark/me/image').then(r => r.data),
}
