export enum Role {
  SUPERADMIN = 'superadmin',
  OWNER = 'owner',
  AGENT = 'agent',
  TENANT = 'tenant',
  SERVICE_PROVIDER = 'service_provider',
}

export interface AuthUser {
  user_id: string
  org_id: string
  role: string
  email?: string
}
