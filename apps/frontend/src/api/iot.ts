import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '@/constants/storage'
import type {
  Device, ProvisionedDevice, DeviceType, DeviceRegisterPayload, DeviceUpdatePayload,
  QuarantinePayload, SSHAccessRequest, SSHRequestPayload, SSHAuditLog, SSHSetupInfo,
  AlertRule, AlertRulePayload, OTAUpdate, DeviceGroup, DeviceGroupPayload,
  DeviceCommand, CommandPayload, BulkCommandPayload,
  RegisterDeviceResult,
} from '@/types/iot'

// ── IoT-service axios instance ────────────────────────────────────────────
// The IoT service runs on a separate port (8020); we replicate the same
// auth-interceptor pattern as api/client.ts for a seamless experience.

const iotBaseURL = import.meta.env.VITE_IOT_API_BASE_URL
  ? `${import.meta.env.VITE_IOT_API_BASE_URL}/api/v1`
  : 'http://localhost:8020/api/v1'

const iotClient = axios.create({
  baseURL: iotBaseURL,
  headers: { 'Content-Type': 'application/json' },
})

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// Request interceptor: attach Bearer token
iotClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // Let the browser set Content-Type for multipart uploads (includes boundary)
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

// Response interceptor: refresh-then-retry on 401
type FailedRequest = {
  resolve: (token: string) => void
  reject: (err: unknown) => void
}

let isRefreshing = false
let failedQueue: FailedRequest[] = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  failedQueue = []
}

// Use main api base URL for token refresh (refresh endpoint lives on PMS backend)
const mainBaseURL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1`
  : '/api/v1'

iotClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)

    if (!refreshToken) {
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` }
        return iotClient(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const { data } = await axios.post(`${mainBaseURL}/auth/refresh`, { refresh_token: refreshToken })
      const newToken: string = data.token
      localStorage.setItem(TOKEN_KEY, newToken)
      iotClient.defaults.headers.common.Authorization = `Bearer ${newToken}`
      processQueue(null, newToken)
      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` }
      return iotClient(original)
    } catch (refreshError) {
      processQueue(refreshError, null)
      clearAuth()
      window.location.href = '/login'
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

const IOT_BASE = ''

// ── Devices ───────────────────────────────────────────────────────────────
export const devicesApi = {
  list: (params?: {
    property_id?: string; status?: string; category?: string
    page?: number; page_size?: number; search?: string
  }) =>
    iotClient.get<Device[]>(`${IOT_BASE}/devices`, { params }).then(r => r.data),

  get: (id: string) =>
    iotClient.get<Device>(`${IOT_BASE}/devices/${id}`).then(r => r.data),

  create: (payload: DeviceRegisterPayload) =>
    iotClient.post<ProvisionedDevice>(`${IOT_BASE}/devices`, payload).then(r => r.data),

  update: (id: string, payload: DeviceUpdatePayload) =>
    iotClient.patch<Device>(`${IOT_BASE}/devices/${id}`, payload).then(r => r.data),

  delete: (id: string) =>
    iotClient.delete(`${IOT_BASE}/devices/${id}`),

  rotateCredentials: (id: string) =>
    iotClient.post<ProvisionedDevice>(`${IOT_BASE}/devices/${id}/rotate-credentials`).then(r => r.data),

  getSSHSetup: (id: string) =>
    iotClient.get<SSHSetupInfo>(`${IOT_BASE}/devices/${id}/ssh-setup`).then(r => r.data),

  quarantine: (id: string, payload: QuarantinePayload) =>
    iotClient.post<Device>(`${IOT_BASE}/devices/${id}/quarantine`, payload).then(r => r.data),

  unquarantine: (id: string) =>
    iotClient.delete<Device>(`${IOT_BASE}/devices/${id}/quarantine`).then(r => r.data),

  getTailscalePreauthKey: (id: string) =>
    iotClient.post<{ preauth_key: string; tailscale_cmd: string; headscale_login_server: string; note: string }>(
      `${IOT_BASE}/devices/${id}/tailscale/preauth-key`
    ).then(r => r.data),

  syncTailscaleNode: (id: string) =>
    iotClient.post<{ synced: boolean; tailscale_ip?: string; tailscale_node_id?: string; message?: string }>(
      `${IOT_BASE}/devices/${id}/tailscale/sync`
    ).then(r => r.data),

  getLastTelemetry: (id: string) =>
    iotClient.get<{ data: Record<string, unknown> | null; ts: string | null }>(`${IOT_BASE}/devices/${id}/last-telemetry`).then(r => r.data),

  downloadTestScript: async (id: string, filename: string) => {
    const res = await iotClient.get(`${IOT_BASE}/devices/${id}/test-script`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/x-shellscript' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  },
}

// ── Device Types ──────────────────────────────────────────────────────────
export const deviceTypesApi = {
  list: (params?: { category?: string; org_id?: string }) =>
    iotClient.get<DeviceType[]>(`${IOT_BASE}/device-types`, { params }).then(r => r.data),

  get: (id: string) =>
    iotClient.get<DeviceType>(`${IOT_BASE}/device-types/${id}`).then(r => r.data),

  create: (payload: Partial<DeviceType>) =>
    iotClient.post<DeviceType>(`${IOT_BASE}/device-types`, payload).then(r => r.data),

  update: (id: string, payload: Partial<DeviceType>) =>
    iotClient.patch<DeviceType>(`${IOT_BASE}/device-types/${id}`, payload).then(r => r.data),

  delete: (id: string) =>
    iotClient.delete(`${IOT_BASE}/device-types/${id}`),
}

// ── SSH Requests ──────────────────────────────────────────────────────────
export const sshApi = {
  listRequests: (params?: {
    property_id?: string; target_id?: string; status?: string
    page?: number; page_size?: number
  }) =>
    iotClient.get<SSHAccessRequest[]>(`${IOT_BASE}/ssh-requests`, { params }).then(r => r.data),

  createRequest: (payload: SSHRequestPayload) =>
    iotClient.post<SSHAccessRequest>(`${IOT_BASE}/ssh-requests`, payload).then(r => r.data),

  approve: (id: string) =>
    iotClient.post<SSHAccessRequest>(`${IOT_BASE}/ssh-requests/${id}/approve`).then(r => r.data),

  deny: (id: string, reason?: string) =>
    iotClient.post<SSHAccessRequest>(`${IOT_BASE}/ssh-requests/${id}/deny`, { reason }).then(r => r.data),

  revoke: (id: string) =>
    iotClient.post<SSHAccessRequest>(`${IOT_BASE}/ssh-requests/${id}/revoke`).then(r => r.data),

  listAuditLogs: (params?: {
    request_id?: string; device_id?: string
    page?: number; page_size?: number
  }) =>
    iotClient.get<SSHAuditLog[]>(`${IOT_BASE}/ssh-audit`, { params }).then(r => r.data),

  getReplayUrl: (requestId: string, logId: string) =>
    iotClient.get<{ replay_url: string; format: string; duration_seconds?: number }>(
      `${IOT_BASE}/ssh-requests/${requestId}/audit/${logId}/replay`
    ).then(r => r.data),
}

// ── Alert Rules ───────────────────────────────────────────────────────────
export const alertRulesApi = {
  list: (params?: { property_id?: string; device_id?: string; device_type_id?: string }) =>
    iotClient.get<AlertRule[]>(`${IOT_BASE}/alert-rules`, { params }).then(r => r.data),

  get: (id: string) =>
    iotClient.get<AlertRule>(`${IOT_BASE}/alert-rules/${id}`).then(r => r.data),

  create: (payload: AlertRulePayload) =>
    iotClient.post<AlertRule>(`${IOT_BASE}/alert-rules`, payload).then(r => r.data),

  update: (id: string, payload: Partial<AlertRulePayload>) =>
    iotClient.patch<AlertRule>(`${IOT_BASE}/alert-rules/${id}`, payload).then(r => r.data),

  delete: (id: string) =>
    iotClient.delete(`${IOT_BASE}/alert-rules/${id}`),

  toggle: (id: string, is_active: boolean) =>
    iotClient.patch<AlertRule>(`${IOT_BASE}/alert-rules/${id}`, { is_active }).then(r => r.data),
}

// ── OTA Updates ───────────────────────────────────────────────────────────
export const otaApi = {
  list: (params?: { status?: string; device_type_id?: string }) =>
    iotClient.get<OTAUpdate[]>(`${IOT_BASE}/ota`, { params }).then(r => r.data),

  get: (id: string) =>
    iotClient.get<OTAUpdate>(`${IOT_BASE}/ota/${id}`).then(r => r.data),

  uploadFirmware: (formData: FormData) =>
    iotClient.post<OTAUpdate>(`${IOT_BASE}/ota/firmware/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),

  start: (id: string) =>
    iotClient.post<OTAUpdate>(`${IOT_BASE}/ota/${id}/start`).then(r => r.data),

  pause: (id: string) =>
    iotClient.post<OTAUpdate>(`${IOT_BASE}/ota/${id}/pause`).then(r => r.data),

  cancel: (id: string) =>
    iotClient.delete<OTAUpdate>(`${IOT_BASE}/ota/${id}`).then(r => r.data),
}

// ── Fleets / Device Groups ────────────────────────────────────────────────
export const fleetsApi = {
  list: (params?: { property_id?: string }) =>
    iotClient.get<DeviceGroup[]>(`${IOT_BASE}/fleets`, { params }).then(r => r.data),

  get: (id: string) =>
    iotClient.get<DeviceGroup>(`${IOT_BASE}/fleets/${id}`).then(r => r.data),

  create: (payload: DeviceGroupPayload) =>
    iotClient.post<DeviceGroup>(`${IOT_BASE}/fleets`, payload).then(r => r.data),

  update: (id: string, payload: Partial<DeviceGroupPayload>) =>
    iotClient.patch<DeviceGroup>(`${IOT_BASE}/fleets/${id}`, payload).then(r => r.data),

  delete: (id: string) =>
    iotClient.delete(`${IOT_BASE}/fleets/${id}`),

  addDevices: (id: string, device_ids: string[]) =>
    iotClient.post<DeviceGroup>(`${IOT_BASE}/fleets/${id}/devices`, { device_ids }).then(r => r.data),

  removeDevices: (id: string, device_ids: string[]) =>
    iotClient.delete<DeviceGroup>(`${IOT_BASE}/fleets/${id}/devices`, { data: { device_ids } }).then(r => r.data),

  bulkCommand: (id: string, payload: BulkCommandPayload) =>
    iotClient.post<DeviceCommand[]>(`${IOT_BASE}/fleets/${id}/commands`, payload).then(r => r.data),

  bulkQuarantine: (id: string, reason: string) =>
    iotClient.post<{ quarantined: number; skipped: number }>(`${IOT_BASE}/fleets/${id}/quarantine`, { reason }).then(r => r.data),
}

// ── Commands ──────────────────────────────────────────────────────────────
export const commandsApi = {
  send: (deviceId: string, payload: CommandPayload) =>
    iotClient.post<DeviceCommand>(`${IOT_BASE}/devices/${deviceId}/commands`, payload).then(r => r.data),

  list: (deviceId: string, params?: { page?: number; page_size?: number }) =>
    iotClient.get<DeviceCommand[]>(`${IOT_BASE}/devices/${deviceId}/commands`, { params }).then(r => r.data),
}

// ── Full-stack Device Registration (sync) ─────────────────────────────────
export const syncApi = {
  registerDevice: (payload: {
    device_uid: string
    device_name: string
    device_type_id: string
    property_id: string
    property_name: string
    unit_id?: string
    unit_name?: string
    store_location_id?: string
    gateway_id?: string
    org_id?: string
    org_name?: string
    description?: string
    serial_number?: string
    tags?: string[]
    capabilities?: Record<string, boolean>
  }) =>
    iotClient.post<RegisterDeviceResult>(`${IOT_BASE}/sync/register-device`, payload).then(r => r.data),

  getCACert: () =>
    iotClient.get<{ ca_cert_pem: string }>(`${IOT_BASE}/sync/ca-cert`).then(r => r.data),

  testConnectivity: () =>
    iotClient.get<Record<string, unknown>>(`${IOT_BASE}/sync/connectivity`).then(r => r.data),
}

// ── Tailscale nodes ───────────────────────────────────────────────────────
export const tailscaleApi = {
  listNodes: () =>
    iotClient.get(`${IOT_BASE}/tailscale/nodes`).then(r => r.data),

  autoRegister: (payload: { node_id: string; entity_type: string; entity_id: string }) =>
    iotClient.post(`${IOT_BASE}/tailscale/nodes/auto-register`, payload).then(r => r.data),
}
