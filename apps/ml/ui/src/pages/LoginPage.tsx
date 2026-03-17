import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { Eye, EyeOff, Loader2, Mail, ArrowRight, Cpu, Zap, BarChart2, Layers } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { onGoHome: () => void; onGoRegister: () => void; onForgotPassword: () => void }

const FEATURE_CARDS = [
  {
    icon: <Cpu size={16} className="text-sky-400" />,
    color: 'border-sky-800/40 bg-sky-950/30',
    iconBg: 'bg-sky-900/40',
    title: 'Train anywhere',
    desc: 'Your machine or cloud GPU — same code, one click to switch.',
  },
  {
    icon: <Zap size={16} className="text-emerald-400" />,
    color: 'border-emerald-800/40 bg-emerald-950/30',
    iconBg: 'bg-emerald-900/40',
    title: 'Live REST API instantly',
    desc: 'Model goes live the moment training completes. No servers to configure.',
  },
  {
    icon: <BarChart2 size={16} className="text-violet-400" />,
    color: 'border-violet-800/40 bg-violet-950/30',
    iconBg: 'bg-violet-900/40',
    title: 'Monitor everything',
    desc: 'Latency, drift, and A/B tests from a single dashboard.',
  },
  {
    icon: <Layers size={16} className="text-amber-400" />,
    color: 'border-amber-800/40 bg-amber-950/30',
    iconBg: 'bg-amber-900/40',
    title: 'Any framework',
    desc: 'sklearn, PyTorch, YOLO, Hugging Face, XGBoost — if it\'s Python, it works.',
  },
]

export default function LoginPage({ onGoHome, onGoRegister, onForgotPassword }: Props) {
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
    <div className="min-h-screen bg-[#060810] flex flex-col">

      {/* ── Beta banner ── */}
      <div className="w-full flex items-center justify-center gap-2.5 bg-amber-950/40 border-b border-amber-800/30 px-4 py-2.5">
        <span className="text-[10px] font-bold text-amber-500 bg-amber-900/50 border border-amber-700/40 rounded px-1.5 py-0.5 flex-shrink-0">BETA</span>
        <p className="text-[11px] text-amber-200/70">
          You're on an early beta.{' '}
          <a href="mailto:support@mldock.io?subject=MLDock%20Beta%20Report"
            className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors">
            Report an issue
          </a>
        </p>
      </div>

      {/* ── Main split layout ── */}
      <div className="flex flex-1">

      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 bg-[#060d1a] border-r border-white/5 relative overflow-hidden">
        {/* background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-sky-600/8 blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-violet-600/6 blur-[100px]" />
        </div>

        <div className="relative">
          <button onClick={onGoHome} className="outline-none">
            <Logo size="md" />
          </button>
        </div>

        <div className="relative space-y-8">
          <div>
            <h2 className="text-3xl font-bold text-white leading-snug tracking-tight mb-3">
              ML infrastructure<br />
              <span className="text-sky-400">on autopilot.</span>
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
              The complete platform for training, deploying, and monitoring machine learning models —
              without managing servers, cloud accounts, or DevOps pipelines.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FEATURE_CARDS.map(card => (
              <div key={card.title} className={`rounded-xl border p-4 space-y-2.5 ${card.color}`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${card.iconBg}`}>
                  {card.icon}
                </div>
                <div>
                  <div className="text-xs font-semibold text-white mb-1">{card.title}</div>
                  <div className="text-[11px] text-gray-500 leading-relaxed">{card.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12">
        {/* Mobile logo */}
        <div className="lg:hidden mb-10">
          <button onClick={onGoHome} className="outline-none">
            <Logo size="md" />
          </button>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Welcome back</h1>
            <p className="text-sm text-gray-500">Sign in to your MLDock account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {unverifiedEmail && (
              <div className="bg-indigo-900/20 border border-indigo-800/40 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Mail size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-indigo-300 leading-relaxed">
                    Verify your email before signing in. Check your inbox for the activation link.
                  </p>
                </div>
                {resentOk
                  ? <p className="text-xs text-green-400 pl-5">New link sent — check your inbox</p>
                  : (
                    <button onClick={handleResend} disabled={resending}
                      className="ml-5 text-xs text-indigo-400 hover:text-indigo-300 underline disabled:opacity-50">
                      {resending ? 'Sending…' : 'Resend verification email'}
                    </button>
                  )
                }
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                autoComplete="email"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                placeholder="you@example.com"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">Password</label>
                <button type="button" onClick={onForgotPassword}
                  className="text-xs text-sky-400 hover:text-sky-300 transition-colors">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} required
                  autoComplete="current-password"
                  className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3 transition-colors shadow-lg shadow-sky-900/30 mt-2">
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Signing in…</>
                : <>Sign in <ArrowRight size={14} /></>}
            </button>
          </form>

          <p className="text-center text-xs text-gray-600 mt-6">
            Don't have an account?{' '}
            <button onClick={onGoRegister} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
              Create one free
            </button>
          </p>

        </div>
      </div>

      </div>
    </div>
  )
}
