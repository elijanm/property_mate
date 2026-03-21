import api from './client'

export interface OrgConfig {
  org_id: string
  slug: string
  org_name: string
  display_name: string
  org_type: string
  previous_slugs: string[]
}

export const orgConfigApi = {
  get: () => api.get<OrgConfig>('/org/config').then(r => r.data),

  update: (body: { slug?: string; org_name?: string; display_name?: string }) =>
    api.patch<OrgConfig>('/org/config', body).then(r => r.data),

  checkSlug: (slug: string) =>
    api.get<{ available: boolean; slug: string }>('/org/config/check-slug', { params: { slug } }).then(r => r.data),

  suggestSlug: () =>
    api.get<{ suggestions: string[] }>('/org/config/suggest-slug').then(r => r.data),
}
