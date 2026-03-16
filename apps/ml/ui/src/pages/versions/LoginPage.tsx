import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { onGoRegister: () => void; onForgotPassword: () => void }

export default function LoginPage({ onGoRegister, onForgotPassword }: Props) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resentOk, setResentOk] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setUnverifiedEmail('')
    setResentOk(false)
    setLoading(true)
    try {
      await login(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      if (msg.includes('EMAIL_NOT_VERIFIED')) {
        setUnverifiedEmail(email)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      await authApi.resendVerification(unverifiedEmail)
      setResentOk(true)
    } catch {}
    finally { setResending(false) }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size="lg" />
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h1 className="text-base font-semibold text-white">Sign in</h1>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {unverifiedEmail && (
            <div className="bg-indigo-900/20 border border-indigo-800/40 rounded-lg px-3 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <Mail size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-indigo-300 leading-relaxed">
                  Please verify your email before signing in.<br />
                  Check your inbox for the activation code or link.
                </p>
              </div>
              {resentOk
                ? <p className="text-xs text-green-400 pl-5">New code sent — check your inbox</p>
                : (
                  <button onClick={handleResend} disabled={resending}
                    className="ml-5 text-xs text-indigo-400 hover:text-indigo-300 underline disabled:opacity-50">
                    {resending ? 'Sending…' : 'Resend verification email'}
                  </button>
                )
              }
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-400 font-medium">Password</label>
              <button type="button" onClick={onForgotPassword} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Signing in…</> : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-4">
          Don't have an account?{' '}
          <button onClick={onGoRegister} className="text-brand-400 hover:text-brand-300 transition-colors">
            Create one
          </button>
        </p>

        {/* Beta notice */}
        <div className="mt-5 flex items-start gap-2 bg-amber-950/30 border border-amber-800/30 rounded-xl px-3.5 py-3">
          <span className="text-[10px] font-bold text-amber-500 bg-amber-900/40 border border-amber-700/40 rounded px-1.5 py-0.5 flex-shrink-0 mt-0.5">BETA</span>
          <p className="text-[11px] text-amber-200/60 leading-relaxed">
            You're using an early beta. Things may break.{' '}
            <a
              href="mailto:support@mldock.io?subject=MLDock%20Beta%20Report"
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
            >
              Report an anomaly
            </a>
          </p>
        </div>

        {/* <p className="text-center text-[10px] text-gray-700 mt-4">
          Default admin: admin@pms-ml.local / Admin@123456
        </p> */}
      </div>
    </div>
  )
}
