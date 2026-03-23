import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import AuthLayout from '@/layouts/AuthLayout'
import apiClient from '@/api/client'
import { authApi } from '@/api/auth'
import { extractApiError } from '@/utils/apiError'
import DisposableEmailModal from '@/components/DisposableEmailModal'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showDisposableModal, setShowDisposableModal] = useState(false)
  const [disposableAttempts, setDisposableAttempts] = useState(0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiClient.post('/auth/login', { email, password })
      const { token, user, refresh_token } = res.data
      login(token, user, refresh_token)

      try {
        const check = await authApi.checkEmail(email)
        if (check.is_disposable && check.confidence !== 'unavailable') {
          setDisposableAttempts(0)
          setShowDisposableModal(true)
          setLoading(false)
          return
        }
      } catch {
        // Inference unavailable — proceed normally
      }

      navigate('/', { replace: true })
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUseRealEmail(realEmail: string) {
    const result = await authApi.updateEmail(realEmail)
    if (!result.is_disposable) {
      setShowDisposableModal(false)
      navigate('/', { replace: true })
    }
    setDisposableAttempts(result.attempts)
    return { is_disposable: result.is_disposable, attempts: result.attempts }
  }

  async function handleKeepDisposable() {
    try { await authApi.ignoreDisposableEmail() } catch { /* best-effort */ }
    setShowDisposableModal(false)
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout>
      {showDisposableModal && (
        <DisposableEmailModal
          suspectedEmail={email}
          attempts={disposableAttempts}
          onUseReal={handleUseRealEmail}
          onKeep={handleKeepDisposable}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 rounded px-4 py-2 text-sm">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="text-center text-sm text-gray-500 mt-2">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="text-blue-600 hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
