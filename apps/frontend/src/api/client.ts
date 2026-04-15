import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '@/constants/storage'

// ── Global error handler (injected by ToastProvider) ─────────────────────────

let _globalErrorHandler: ((message: string) => void) | null = null

export function setGlobalErrorHandler(fn: ((message: string) => void) | null): void {
  _globalErrorHandler = fn
}

const baseURL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1`
  : '/api/v1'

const apiClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

// ── Helpers ──────────────────────────────────────────────────

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// ── Request interceptor: attach Bearer token ─────────────────

apiClient.interceptors.request.use((config) => {
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

// ── Response interceptor: refresh-then-retry on 401 ─────────

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

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status !== 401 || original._retry) {
      const status = error.response?.status
      // Show global toast for unexpected errors; skip:
      //   401 — handled by refresh flow below
      //   404 — not found, components render empty state inline
      //   422 — form validation errors shown inline by components
      // Also skip portal auth endpoints — errors shown inline in the login/verify form
      const isPortalAuth = original.url?.includes('/framework-portal/auth/')
      if (_globalErrorHandler && status !== 401 && status !== 404 && status !== 422 && !isPortalAuth) {
        const msg =
          (error.response?.data as { error?: { message?: string } })?.error?.message ??
          (error.message === 'Network Error' ? 'Network error — check your connection.' : 'An unexpected error occurred.')
        _globalErrorHandler(msg)
      }
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
        return apiClient(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const { data } = await axios.post(`${baseURL}/auth/refresh`, { refresh_token: refreshToken })
      const newToken: string = data.token
      localStorage.setItem(TOKEN_KEY, newToken)
      apiClient.defaults.headers.common.Authorization = `Bearer ${newToken}`
      processQueue(null, newToken)
      original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` }
      return apiClient(original)
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

export default apiClient
