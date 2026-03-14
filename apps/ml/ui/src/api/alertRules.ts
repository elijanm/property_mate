import client from './client'

export interface AlertRule {
  id: string
  name: string
  metric: string
  trainer_name: string | null
  operator: string
  threshold: number
  window_minutes: number
  cooldown_minutes: number
  channels: { type: string; url?: string }[]
  enabled: boolean
  created_by: string
  created_at: string
}

export interface AlertFire {
  id: string
  rule_id: string
  rule_name: string
  trainer_name: string
  metric: string
  value: number
  threshold: number
  message: string
  fired_at: string
}

export const alertRulesApi = {
  list: () => client.get<AlertRule[]>('/alert-rules').then(r => r.data),
  create: (data: Omit<AlertRule, 'id' | 'created_by' | 'created_at'>) =>
    client.post<AlertRule>('/alert-rules', data).then(r => r.data),
  update: (id: string, data: Partial<AlertRule>) =>
    client.patch<AlertRule>(`/alert-rules/${id}`, data).then(r => r.data),
  delete: (id: string) => client.delete(`/alert-rules/${id}`),
  listFires: (rule_id?: string) =>
    client.get<AlertFire[]>('/alert-rules/fires', { params: rule_id ? { rule_id } : {} }).then(r => r.data),
}
