import client from './client'

export interface MLUser {
  id: string
  email: string
  full_name: string
  role: 'viewer' | 'engineer' | 'admin'
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export const usersApi = {
  list: (params?: { role?: string; limit?: number; skip?: number }) =>
    client.get<{ total: number; items: MLUser[] }>('/users', { params }).then(r => r.data),

  create: (data: { email: string; password: string; full_name?: string; role: string }) =>
    client.post<MLUser>('/users', data).then(r => r.data),

  update: (id: string, data: { role?: string; full_name?: string; is_active?: boolean }) =>
    client.patch<MLUser>(`/users/${id}`, data).then(r => r.data),

  deactivate: (id: string) => client.delete(`/users/${id}`),
}
