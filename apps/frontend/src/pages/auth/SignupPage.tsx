import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import AuthLayout from '@/layouts/AuthLayout'
import { authApi } from '@/api/auth'
import type { SignupPayload } from '@/api/auth'
import { extractApiError } from '@/utils/apiError'
import DisposableEmailModal from '@/components/DisposableEmailModal'

type Step = 'details' | 'otp'

export default function SignupPage() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('details')

  const [formData, setFormData] = useState<SignupPayload>({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    org_name: '',
  })
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showDisposableModal, setShowDisposableModal] = useState(false)
  const [disposableAttempts, setDisposableAttempts] = useState(0)

  function updateField(field: keyof SignupPayload, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  async function doSignup(data: SignupPayload) {
    setLoading(true)
    try {
      await authApi.signup(data)
      setStep('otp')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (formData.password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Check for disposable email before proceeding
    setLoading(true)
    try {
      const check = await authApi.checkEmail(formData.email)
      if (check.is_disposable && check.confidence !== 'unavailable') {
        setDisposableAttempts(0)
        setShowDisposableModal(true)
        setLoading(false)
        return
      }
    } catch {
      // Inference unavailable — proceed normally
    }
    setLoading(false)

    await doSignup(formData)
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.verifyOtp({ email: formData.email, otp })
      login(res.token, res.user, res.refresh_token)
      navigate('/', { replace: true })
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleResendOtp() {
    setError('')
    setLoading(true)
    try {
      await authApi.signup(formData)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      {showDisposableModal && (
        <DisposableEmailModal
          suspectedEmail={formData.email}
          attempts={disposableAttempts}
          onUseReal={async (realEmail) => {
            // On signup we check the new email before proceeding
            try {
              const check = await authApi.checkEmail(realEmail)
              if (check.is_disposable && check.confidence !== 'unavailable') {
                const next = disposableAttempts + 1
                setDisposableAttempts(next)
                return { is_disposable: true, attempts: next }
              }
            } catch { /* unavailable — proceed */ }
            setShowDisposableModal(false)
            const updated = { ...formData, email: realEmail }
            setFormData(updated)
            doSignup(updated)
            return { is_disposable: false, attempts: 0 }
          }}
          onKeep={() => {
            setShowDisposableModal(false)
            doSignup(formData)
          }}
        />
      )}

      {step === 'details' ? (
        <form onSubmit={handleDetailsSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 rounded px-4 py-2 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input
                type="text"
                required
                value={formData.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input
                type="text"
                required
                value={formData.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organisation name
            </label>
            <input
              type="text"
              required
              value={formData.org_name}
              onChange={(e) => updateField('org_name', e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={formData.password}
              onChange={(e) => updateField('password', e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Continue'}
          </button>
          <p className="text-center text-sm text-gray-500 mt-2">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleOtpSubmit} className="space-y-4">
          <div className="text-center mb-2">
            <p className="text-sm text-gray-600">
              We sent a 6-digit code to{' '}
              <span className="font-medium text-gray-900">{formData.email}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">The code expires in 10 minutes.</p>
          </div>
          {error && (
            <div className="bg-red-50 text-red-700 rounded px-4 py-2 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Verification code
            </label>
            <input
              type="text"
              required
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <p className="text-center text-sm text-gray-500">
            Didn&apos;t receive the code?{' '}
            <button
              type="button"
              disabled={loading}
              onClick={handleResendOtp}
              className="text-blue-600 hover:underline font-medium disabled:opacity-50"
            >
              Resend OTP
            </button>
          </p>
          <p className="text-center text-sm text-gray-500">
            <button
              type="button"
              onClick={() => { setStep('details'); setError('') }}
              className="text-gray-400 hover:underline text-xs"
            >
              Back to sign up
            </button>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}
