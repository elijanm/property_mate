import client from './client'

export interface AuditLog {
  id: string
  actor_email: string
  action: string
  resource_type: string
  resource_id: string | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export const auditApi = {
  list: (params?: { actor_email?: string; resource_type?: string; action?: string; limit?: number; skip?: number }) =>
    client.get<{ total: number; items: AuditLog[] }>('/audit', { params }).then(r => r.data),
}
