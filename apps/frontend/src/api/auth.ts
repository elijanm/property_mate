import client from '@/api/client'

export interface MeResponse {
  user_id: string
  org_id: string | null
  role: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

export const authApi = {
  me(): Promise<MeResponse> {
    return client.get<MeResponse>('/auth/me').then((r) => r.data)
  },
}
