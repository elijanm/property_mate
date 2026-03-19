import client from './client'

export interface DiscoverEngineer {
  id: string
  name: string
  email_domain: string
  role: string
  org_id: string
  model_count: number
  dataset_count: number
  frameworks: string[]
  joined_at: string | null
}

export interface DiscoverEngineerDetail extends DiscoverEngineer {
  models: DiscoverModel[]
  datasets: DiscoverDataset[]
}

export interface DiscoverModel {
  id: string
  trainer_name: string
  version: string
  status: string
  tags: Record<string, string>
  category: Record<string, string>
  metrics: Record<string, number>
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  org_id: string
  publisher_name: string
  publisher_id: string | null
  created_at: string | null
}

export interface DiscoverDataset {
  id: string
  name: string
  slug: string | null
  description: string
  category: string
  status: string
  entry_count_cache: number
  field_types: string[]
  field_count: number
  fields: { id: string; type: string; label: string }[]
  org_id: string
  publisher_name: string
  publisher_id: string | null
  created_at: string | null
  visibility: string
  points_enabled: boolean
}

export const discoverApi = {
  listEngineers: (search?: string) =>
    client.get<DiscoverEngineer[]>('/discover/engineers', { params: { search: search ?? '' } }).then(r => r.data),

  getEngineer: (id: string) =>
    client.get<DiscoverEngineerDetail>(`/discover/engineers/${id}`).then(r => r.data),

  listModels: (params?: { search?: string; framework?: string; category?: string }) =>
    client.get<DiscoverModel[]>('/discover/models', { params }).then(r => r.data),

  listDatasets: (params?: { search?: string; field_type?: string }) =>
    client.get<DiscoverDataset[]>('/discover/datasets', { params }).then(r => r.data),
}
