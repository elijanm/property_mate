import client from './client'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  rate_limit_per_min: number
  expires_at: string | null
  last_used_at: string | null
  usage_count: number
  created_at: string
}

export const apiKeysApi = {
  list: () => client.get<ApiKey[]>('/api-keys').then(r => r.data),
  create: (name: string, rate_limit_per_min = 60, expires_at?: string) =>
    client.post<{ id: string; key: string; prefix: string; name: string; note: string }>(
      '/api-keys', { name, rate_limit_per_min, expires_at }
    ).then(r => r.data),
  revoke: (id: string) => client.delete(`/api-keys/${id}`),
}
