import client from '@/api/client'
import type {
  CallSession,
  CallSessionListResponse,
  InstalledApp,
  VoiceAgentConfig,
  VoiceAgentMetrics,
  VoiceOption,
} from '@/types/apps'

export const appsApi = {
  // ── Installed apps ───────────────────────────────────────────────────────

  list(): Promise<{ items: InstalledApp[] }> {
    return client.get<{ items: InstalledApp[] }>('/apps').then((r) => r.data)
  },

  get(appId: string): Promise<InstalledApp> {
    return client.get<InstalledApp>(`/apps/${appId}`).then((r) => r.data)
  },

  install(appId: string, appName: string, config: Partial<VoiceAgentConfig>): Promise<InstalledApp> {
    return client.post<InstalledApp>(`/apps/${appId}/install`, { app_name: appName, config }).then((r) => r.data)
  },

  updateConfig(appId: string, config: Partial<VoiceAgentConfig>): Promise<InstalledApp> {
    return client.patch<InstalledApp>(`/apps/${appId}/config`, { config }).then((r) => r.data)
  },

  uninstall(appId: string): Promise<void> {
    return client.delete(`/apps/${appId}`).then(() => undefined)
  },

  // ── Voice Agent specific ─────────────────────────────────────────────────

  listCalls(params?: {
    page?: number
    page_size?: number
    status?: string
    tenant_id?: string
  }): Promise<CallSessionListResponse> {
    return client.get<CallSessionListResponse>('/apps/voice-agent/calls', { params }).then((r) => r.data)
  },

  getCall(sessionId: string): Promise<CallSession> {
    return client.get<CallSession>(`/apps/voice-agent/calls/${sessionId}`).then((r) => r.data)
  },

  getMetrics(): Promise<VoiceAgentMetrics> {
    return client.get<VoiceAgentMetrics>('/apps/voice-agent/metrics').then((r) => r.data)
  },

  getWaitlist(): Promise<{ app_ids: string[] }> {
    return client.get<{ app_ids: string[] }>('/apps/waitlist').then((r) => r.data)
  },

  notifyMe(appId: string): Promise<{ ok: boolean; app_id: string }> {
    return client.post<{ ok: boolean; app_id: string }>(`/apps/${appId}/notify-me`).then((r) => r.data)
  },

  listVoices(provider: string): Promise<{ voices: VoiceOption[] }> {
    return client.get<{ voices: VoiceOption[] }>('/apps/voice-agent/voices', { params: { provider } }).then((r) => r.data)
  },

  sandbox(params: {
    scenario: string
    phone_number?: string
    message?: string
  }): Promise<Record<string, unknown>> {
    return client.post<Record<string, unknown>>('/apps/voice-agent/sandbox', params).then((r) => r.data)
  },

  hangupCall(callControlId: string): Promise<{ ok: boolean }> {
    return client.post<{ ok: boolean }>(`/apps/voice-agent/calls/${callControlId}/hangup`).then((r) => r.data)
  },

  getRecordingUrl(sessionId: string): Promise<{ url: string; key: string }> {
    return client.get<{ url: string; key: string }>(`/apps/voice-agent/calls/${sessionId}/recording`).then((r) => r.data)
  },
}
