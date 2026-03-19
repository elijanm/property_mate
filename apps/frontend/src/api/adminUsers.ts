import client from './client'

export interface AdminUser {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  org_id: string | null
  is_active: boolean
  created_at: string
}

export interface AdminUserListResponse {
  items: AdminUser[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export const adminUsersApi = {
  list: (params: {
    q?: string
    role?: string
    is_active?: boolean
    page?: number
    page_size?: number
  }) =>
    client.get<AdminUserListResponse>('/admin/users', { params }).then(r => r.data),

  suspend: (userId: string, is_active: boolean) =>
    client.patch<AdminUser>(`/admin/users/${userId}/suspend`, { is_active }).then(r => r.data),
}
