import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, Loader2, ArrowRight, Cpu, Zap, Database, Layers } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { onGoLogin: () => void }

const PERK_CARDS = [
  {
    icon: <Cpu size={16} className="text-sky-400" />,
    color: 'border-sky-800/40 bg-sky-950/30',
    iconBg: 'bg-sky-900/40',
    title: 'Standard compute included',
    desc: 'Train on our server from day one — no card, no setup required.',
  },
  {
    icon: <Zap size={16} className="text-emerald-400" />,
    color: 'border-emerald-800/40 bg-emerald-950/30',
    iconBg: 'bg-emerald-900/40',
    title: 'Live REST API on first deploy',
    desc: 'Signed keys, model versioning, zero-downtime rollback.',
  },
  {
    icon: <Database size={16} className="text-violet-400" />,
    color: 'border-violet-800/40 bg-violet-950/30',
    iconBg: 'bg-violet-900/40',
    title: 'Wallet billing — no surprises',
    desc: 'Pre-fund locally, spend on GPU time. Never post-billed.',
  },
  {
    icon: <Layers size={16} className="text-amber-400" />,
    color: 'border-amber-800/40 bg-amber-950/30',
    iconBg: 'bg-amber-900/40',
    title: 'Any Python framework',
    desc: 'sklearn, PyTorch, YOLO, transformers — bring your existing code.',
  },
]

export default function RegisterPage({ onGoLogin }: Props) {
  const { register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')
    setLoading(true)
    try {
      await register(email, password, fullName)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#060810] flex">

      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 bg-[#060d1a] border-r border-white/5 relative overflow-hidden">
        {/* background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-sky-600/8 blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-violet-600/6 blur-[100px]" />
        </div>

        <div className="relative">
          <Logo size="md" />
        </div>

        <div className="relative space-y-8">
          <div>
            <h2 className="text-3xl font-bold text-white leading-snug tracking-tight mb-3">
              Start training models<br />
              <span className="text-sky-400">in minutes.</span>
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
              No AWS account. No infrastructure setup. No credit card required.
              Write your trainer, drop the file, and your first model is live.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {PERK_CARDS.map(card => (
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

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-500/20 bg-sky-500/5 text-sky-400 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            Open beta — free to start today
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12">
        {/* Mobile logo */}
        <div className="lg:hidden mb-10">
          <Logo size="md" />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Create your account</h1>
            <p className="text-sm text-gray-500">Free to start — no credit card required</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* Full name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Full name</label>
              <input
                type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                autoComplete="name"
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                placeholder="Jane Smith"
              />
            </div>

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
              <label className="text-xs font-medium text-gray-400">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)} required
                  autoComplete="new-password"
                  className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="Min. 8 characters"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'} value={confirm}
                  onChange={e => setConfirm(e.target.value)} required
                  autoComplete="new-password"
                  className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3 transition-colors shadow-lg shadow-sky-900/30 mt-1">
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Creating account…</>
                : <>Create free account <ArrowRight size={14} /></>}
            </button>

            <p className="text-[11px] text-gray-600 text-center leading-relaxed">
              By creating an account you agree to our{' '}
              <span className="text-gray-500">Terms of Service</span> and{' '}
              <span className="text-gray-500">Privacy Policy</span>.
            </p>
          </form>

          <p className="text-center text-xs text-gray-600 mt-6">
            Already have an account?{' '}
            <button onClick={onGoLogin} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
              Sign in
            </button>
          </p>
        </div>
      </div>

    </div>
  )
}
