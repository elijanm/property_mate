import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSetupContext, activateVendorAccount } from '@/api/vendors'
import { useAuth } from '@/hooks/useAuth'
import { extractApiError } from '@/utils/apiError'
import type { VendorSetupContext } from '@/types/vendor'
import type { AuthUser } from '@/types/auth'

export default function VendorSetupPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { login } = useAuth()

  const [context, setContext] = useState<VendorSetupContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    getSetupContext(token)
      .then(setContext)
      .catch((err) => setLoadError(extractApiError(err).message))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!token) return

    setSubmitting(true)
    setError(null)
    try {
      const result = await activateVendorAccount(token, password)
      const authUser: AuthUser = {
        user_id: result.user_id,
        org_id: result.org_id ?? '',
        role: result.role,
        email: result.email,
      }
      login(result.token, authUser)
      navigate('/service-provider', { replace: true })
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 mb-2">Invalid Setup Link</p>
          <p className="text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!context) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-gray-900">Set Up Your Account</h1>
          <p className="text-gray-500 mt-2">
            Welcome, <strong>{context.contact_name}</strong>!<br />
            Create a password for <span className="text-blue-600">{context.contact_email}</span>
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password"
              required
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Activating…' : 'Activate Account & Sign In'}
          </button>
        </form>

        <p className="text-xs text-center text-gray-400 mt-6">
          {context.company_name} · Vendor Portal
        </p>
      </div>
    </div>
  )
}
