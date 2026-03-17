/**
 * ClaimAccountPage — lets a data collector claim their rewards account.
 * Accessible at /claim/<collector_token> without authentication.
 *
 * The collector's email is already verified (they received the collect link
 * in their inbox), so no extra OTP verification is required for account creation.
 *
 * Two paths:
 *   1. Set Password  — creates a new account (or logs into existing one)
 *   2. Login with OTP — sends a 6-digit code to their email, passwordless
 */
import { useState, useEffect } from 'react'
import {
  Star, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle,
  Mail, Lock, KeyRound, ArrowRight, Gift,
} from 'lucide-react'
import clsx from 'clsx'
import client from '@/api/client'

// ── API helpers (no auth required) ────────────────────────────────────────────

interface ClaimInfo {
  masked_email: string
  collector_name: string
  total_points: number
  has_account: boolean
}

interface ClaimResult {
  access_token: string
  refresh_token: string
  user: { email: string; role: string; name: string }
}

const claimApi = {
  info: (token: string) =>
    client.get<ClaimInfo>(`/annotator/claim/${token}/info`).then(r => r.data),

  setPassword: (token: string, password: string, full_name: string) =>
    client.post<ClaimResult>(`/annotator/claim/${token}/set-password`, { password, full_name }).then(r => r.data),

  requestOtp: (token: string) =>
    client.post<{ sent: boolean; masked_email: string }>(`/annotator/claim/${token}/request-otp`).then(r => r.data),

  verifyOtp: (token: string, otp: string) =>
    client.post<ClaimResult>(`/annotator/claim/${token}/verify-otp`, { otp }).then(r => r.data),
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PointsBadge({ points }: { points: number }) {
  return (
    <div className="inline-flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-2xl px-5 py-3">
      <Star size={18} className="text-amber-400" fill="currentColor" />
      <span className="text-base font-bold text-amber-300">{points} points earned</span>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors',
        active
          ? 'bg-indigo-600 text-white'
          : 'text-gray-400 hover:text-gray-200',
      )}
    >
      {children}
    </button>
  )
}

// ── Password tab ───────────────────────────────────────────────────────────────

function PasswordTab({
  token,
  hasAccount,
  onSuccess,
}: {
  token: string
  hasAccount: boolean
  onSuccess: (result: ClaimResult) => void
}) {
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (!hasAccount && password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const result = await claimApi.setPassword(token, password, fullName)
      onSuccess(result)
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {!hasAccount && (
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Full name <span className="text-gray-600">(optional)</span></label>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          {hasAccount ? 'Password' : 'Set a password'}
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <button onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {!hasAccount && (
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Confirm password</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> {hasAccount ? 'Logging in…' : 'Creating account…'}</>
          : <><Lock size={15} /> {hasAccount ? 'Login' : 'Create account & claim'} <ArrowRight size={15} /></>
        }
      </button>
    </div>
  )
}

// ── OTP tab ────────────────────────────────────────────────────────────────────

function OtpTab({
  token,
  onSuccess,
}: {
  token: string
  onSuccess: (result: ClaimResult) => void
}) {
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const requestOtp = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await claimApi.requestOtp(token)
      setMaskedEmail(res.masked_email)
      setStep('verify')
    } catch (e: any) {
      setError(e?.message || 'Failed to send code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async () => {
    setError('')
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return }
    setLoading(true)
    try {
      const result = await claimApi.verifyOtp(token, otp)
      onSuccess(result)
    } catch (e: any) {
      setError(e?.message || 'Invalid or expired code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'request') {
    return (
      <div className="space-y-4">
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4 text-sm text-gray-300 leading-relaxed">
          <p>We'll send a 6-digit code to your email. No password needed.</p>
        </div>

        {error && (
          <p className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} /> {error}
          </p>
        )}

        <button
          onClick={requestOtp}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Sending code…</>
            : <><Mail size={15} /> Send login code <ArrowRight size={15} /></>
          }
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-indigo-900/20 border border-indigo-800/40 rounded-xl p-4 text-sm text-indigo-200">
        Code sent to <strong>{maskedEmail}</strong>. Check your inbox (and spam folder).
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">6-digit code</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-2xl font-mono tracking-[0.5em] text-white text-center placeholder-gray-700 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      <button
        onClick={verifyOtp}
        disabled={loading || otp.length !== 6}
        className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
          : <><KeyRound size={15} /> Verify & access portal <ArrowRight size={15} /></>
        }
      </button>

      <button
        onClick={() => { setStep('request'); setOtp(''); setError('') }}
        className="w-full text-xs text-gray-500 hover:text-gray-300 py-1 transition-colors"
      >
        Resend code
      </button>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ClaimAccountPage({ token }: { token: string }) {
  const [info, setInfo] = useState<ClaimInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'password' | 'otp'>('otp')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    claimApi.info(token)
      .then(d => {
        setInfo(d)
        // Default to OTP tab — lower friction for mobile
        setTab('otp')
      })
      .catch(e => setLoadError(e?.message || 'Invalid or expired link.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSuccess = (result: ClaimResult) => {
    // Store annotator tokens in separate namespace — never overwrites engineer session
    localStorage.setItem('ml_annotator_token', result.access_token)
    localStorage.setItem('ml_annotator_refresh', result.refresh_token)
    localStorage.setItem('ml_annotator_user', JSON.stringify({
      email: result.user.email,
      role: result.user.role,
      full_name: result.user.name,
      org_id: '',
    }))
    setSuccess(true)
    setTimeout(() => { window.location.href = '/' }, 1500)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-xs">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Link not found</p>
          <p className="text-sm text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-900/40 border-2 border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Account ready!</h2>
          <p className="text-sm text-gray-400">Opening your rewards portal…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#060810] text-white flex flex-col">
      {/* Header */}
      <div className="px-4 pt-10 pb-6 text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-lg">🧠</div>
          <span className="text-lg font-bold">MLDock.io</span>
        </div>

        {info && info.total_points > 0 ? (
          <>
            <div className="flex justify-center mb-3">
              <PointsBadge points={info.total_points} />
            </div>
            <h1 className="text-xl font-bold text-white mb-1">Claim your rewards!</h1>
            <p className="text-sm text-gray-400 leading-relaxed">
              Hi <strong className="text-white">{info.collector_name || 'there'}</strong>!
              You've earned points contributing data. Sign in to track and redeem them.
            </p>
          </>
        ) : (
          <>
            <Gift size={36} className="text-indigo-400 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-white mb-1">Access your portal</h1>
            <p className="text-sm text-gray-400">
              Sign in to browse tasks, earn points, and redeem airtime rewards.
            </p>
          </>
        )}

        {info && (
          <p className="mt-2 text-xs text-gray-600">
            Account: <span className="text-gray-500 font-mono">{info.masked_email}</span>
          </p>
        )}
      </div>

      {/* Card */}
      <div className="flex-1 px-4 pb-10">
        <div className="max-w-sm mx-auto bg-gray-900/60 border border-gray-800 rounded-2xl p-6 space-y-5">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl">
            <TabBtn active={tab === 'otp'} onClick={() => setTab('otp')}>
              Login with OTP
            </TabBtn>
            <TabBtn active={tab === 'password'} onClick={() => setTab('password')}>
              {info?.has_account ? 'Password' : 'Set Password'}
            </TabBtn>
          </div>

          {tab === 'otp'
            ? <OtpTab token={token} onSuccess={handleSuccess} />
            : <PasswordTab token={token} hasAccount={info?.has_account ?? false} onSuccess={handleSuccess} />
          }
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">
          Only the email that received the collection link can access this account.
        </p>
      </div>
    </div>
  )
}
