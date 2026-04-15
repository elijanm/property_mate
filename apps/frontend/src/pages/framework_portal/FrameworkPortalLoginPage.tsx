import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalLogin, requestPortalOtp, verifyPortalOtp } from '@/api/frameworkPortal'
import { TOKEN_KEY, USER_KEY } from '@/constants/storage'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

type Mode = 'choose' | 'password' | 'otp-email' | 'otp-verify'

export default function FrameworkPortalLoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  function storeAndRedirect(token: string, name: string, status: string) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify({ role: 'service_provider', name, status }))
    navigate('/framework-portal')
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, name, status } = await portalLogin(email, password)
      storeAndRedirect(token, name, status)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await requestPortalOtp(email)
      setOtpSent(true)
      setMode('otp-verify')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, name, status } = await verifyPortalOtp(email, otp)
      storeAndRedirect(token, name, status)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3" style={{ backgroundColor: ACCENT }}>
            SP
          </div>
          <h1 className="text-xl font-bold text-gray-900">Service Provider Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access your work orders and tickets</p>
        </div>

        {/* Mode chooser */}
        {mode === 'choose' && (
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-3">
            <button
              onClick={() => setMode('otp-email')}
              className="w-full py-3.5 rounded-xl font-semibold text-sm text-white"
              style={{ backgroundColor: ACCENT }}
            >
              📧 Sign in with Email Code
            </button>
            <button
              onClick={() => setMode('password')}
              className="w-full py-3.5 rounded-xl font-semibold text-sm text-gray-700 border border-gray-200 hover:border-amber-400 hover:text-amber-700"
            >
              🔑 Sign in with Password
            </button>
            <p className="text-center text-xs text-gray-400 pt-1">
              New invitation? <span className="text-amber-600">Check your email for the setup link.</span>
            </p>
          </div>
        )}

        {/* Password login */}
        {mode === 'password' && (
          <form onSubmit={handlePasswordLogin} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="your@email.com"
                className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your password"
                className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>

            <button type="button" onClick={() => { setMode('choose'); setError('') }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">
              ← Back
            </button>
          </form>
        )}

        {/* OTP — enter email */}
        {mode === 'otp-email' && (
          <form onSubmit={handleRequestOtp} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            <p className="text-sm text-gray-600">Enter your registered email and we'll send you a 6-digit sign-in code.</p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="your@email.com"
                className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? 'Sending…' : 'Send Code →'}
            </button>

            <button type="button" onClick={() => { setMode('choose'); setError('') }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">
              ← Back
            </button>
          </form>
        )}

        {/* OTP — enter code */}
        {mode === 'otp-verify' && (
          <form onSubmit={handleVerifyOtp} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            {otpSent && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                <p className="text-sm text-green-700 font-medium">Code sent!</p>
                <p className="text-xs text-green-600 mt-0.5">Check <strong>{email}</strong> — expires in 10 minutes.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">6-Digit Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                required
                placeholder="000000"
                autoFocus
                className="w-full border border-gray-300 rounded-xl px-3 py-3 text-center text-2xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? 'Verifying…' : 'Verify & Sign In →'}
            </button>

            <div className="flex justify-between items-center">
              <button type="button" onClick={() => { setMode('otp-email'); setOtp(''); setError('') }}
                className="text-xs text-amber-600 hover:text-amber-800">
                Resend code
              </button>
              <button type="button" onClick={() => { setMode('choose'); setOtp(''); setError('') }}
                className="text-xs text-gray-400 hover:text-gray-600">
                ← Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
