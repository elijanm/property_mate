export interface Tenant {
  id: string
  org_id: string
  email: string
  first_name: string
  last_name: string
  phone?: string
  role: 'tenant'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TenantCreateRequest {
  email: string
  first_name: string
  last_name: string
  phone?: string
  password: string
}

export interface TenantUpdateRequest {
  first_name?: string
  last_name?: string
  phone?: string
  is_active?: boolean
}
