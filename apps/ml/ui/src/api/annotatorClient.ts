import axios from 'axios'

const annotatorClient = axios.create({
  baseURL: '/api/v1',
  timeout: 120_000,
})

// Inject annotator-specific token (separate namespace from main engineer session)
annotatorClient.interceptors.request.use(config => {
  const token = localStorage.getItem('ml_annotator_token')
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Handle 401 — try refresh, then clear annotator session
annotatorClient.interceptors.response.use(
  r => r,
  async err => {
    const msg = err.response?.data?.detail || err.response?.data?.error?.message || err.message
    if (err.response?.status === 401 && !err.config._retried) {
      const refresh = localStorage.getItem('ml_annotator_refresh')
      if (refresh) {
        try {
          err.config._retried = true
          const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refresh })
          const newToken = res.data.access_token
          localStorage.setItem('ml_annotator_token', newToken)
          err.config.headers['Authorization'] = `Bearer ${newToken}`
          return annotatorClient(err.config)
        } catch {
          localStorage.removeItem('ml_annotator_token')
          localStorage.removeItem('ml_annotator_refresh')
          localStorage.removeItem('ml_annotator_user')
          window.location.href = '/'
        }
      }
    }
    return Promise.reject(new Error(msg))
  }
)

export default annotatorClient
