import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, Loader2, ArrowRight, Cpu, Zap, Database, Layers, Gift, Star, Camera } from 'lucide-react'
import Logo from '@/components/Logo'
import { annotatorApi } from '@/api/annotator'

interface Props { onGoLogin: () => void }

// Detect annotator signup mode from URL params
const _searchParams = new URLSearchParams(window.location.search)
const _URL_ROLE = _searchParams.get('role')
const _URL_REF = _searchParams.get('ref')
const _IS_ANNOTATOR_MODE = _URL_ROLE === 'annotator' || !!_URL_REF

const ANNOTATOR_PERKS = [
  {
    icon: <Camera size={16} className="text-sky-400" />,
    color: 'border-sky-800/40 bg-sky-950/30',
    iconBg: 'bg-sky-900/40',
    title: 'Capture real-world data',
    desc: 'Take photos, fill forms, and contribute to AI training datasets.',
  },
  {
    icon: <Gift size={16} className="text-emerald-400" />,
    color: 'border-emerald-800/40 bg-emerald-950/30',
    iconBg: 'bg-emerald-900/40',
    title: 'Earn airtime rewards',
    desc: 'Convert points to airtime instantly sent to your phone.',
  },
  {
    icon: <Star size={16} className="text-amber-400" />,
    color: 'border-amber-800/40 bg-amber-950/30',
    iconBg: 'bg-amber-900/40',
    title: 'Work at your own pace',
    desc: 'Pick tasks that fit your schedule and location.',
  },
  {
    icon: <Layers size={16} className="text-violet-400" />,
    color: 'border-violet-800/40 bg-violet-950/30',
    iconBg: 'bg-violet-900/40',
    title: 'Variety of tasks',
    desc: 'Agriculture, livestock, documents, traffic, and more categories.',
  },
]

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
  const [isAnnotatorMode] = useState(_IS_ANNOTATOR_MODE)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [annotatorSuccess, setAnnotatorSuccess] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')
    setLoading(true)
    try {
      if (isAnnotatorMode) {
        await annotatorApi.register(email, password, fullName, _URL_REF ?? undefined)
        setAnnotatorSuccess(true)
      } else {
        await register(email, password, fullName)
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? (err instanceof Error ? err.message : 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  const perks = isAnnotatorMode ? ANNOTATOR_PERKS : PERK_CARDS
  const accentColor = isAnnotatorMode ? 'emerald' : 'sky'
  const accentClasses = isAnnotatorMode
    ? { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', dot: 'bg-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30', focus: 'focus:border-emerald-500' }
    : { border: 'border-sky-500/20', bg: 'bg-sky-500/5', text: 'text-sky-400', dot: 'bg-sky-400', btn: 'bg-sky-600 hover:bg-sky-500 shadow-sky-900/30', focus: 'focus:border-sky-500' }

  if (annotatorSuccess) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">🎉</div>
          <div className="text-white font-bold text-xl">You're in!</div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Check your email to verify your account. Once verified, log in and start earning rewards by contributing data.
          </p>
          {_URL_REF && (
            <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
              Referral code <strong>{_URL_REF}</strong> has been applied!
            </div>
          )}
          <button
            onClick={onGoLogin}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#060810] flex">

      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 bg-[#060d1a] border-r border-white/5 relative overflow-hidden">
        {/* background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className={`absolute top-0 left-0 w-[500px] h-[500px] rounded-full ${isAnnotatorMode ? 'bg-emerald-600/8' : 'bg-sky-600/8'} blur-[120px]`} />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-violet-600/6 blur-[100px]" />
        </div>

        <div className="relative">
          <Logo size="md" />
        </div>

        <div className="relative space-y-8">
          <div>
            {isAnnotatorMode ? (
              <>
                <h2 className="text-3xl font-bold text-white leading-snug tracking-tight mb-3">
                  Join as a<br />
                  <span className="text-emerald-400">Data Contributor</span>
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
                  Take photos, fill forms, and earn airtime rewards while helping build AI datasets.
                  Work at your own pace, from anywhere.
                </p>
                {_URL_REF && (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-medium">
                    🎁 Referral code: <strong>{_URL_REF}</strong>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="text-3xl font-bold text-white leading-snug tracking-tight mb-3">
                  Start training models<br />
                  <span className="text-sky-400">in minutes.</span>
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
                  No AWS account. No infrastructure setup. No credit card required.
                  Write your trainer, drop the file, and your first model is live.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {perks.map(card => (
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
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${accentClasses.border} ${accentClasses.bg} ${accentClasses.text} text-xs font-medium`}>
            <span className={`w-1.5 h-1.5 rounded-full ${accentClasses.dot} animate-pulse`} />
            {isAnnotatorMode ? 'Earn airtime rewards for every contribution' : 'Open beta — free to start today'}
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
            {isAnnotatorMode ? (
              <>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 text-xs font-semibold mb-3">
                  🏆 Data Contributor Programme
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Join &amp; start earning</h1>
                <p className="text-sm text-gray-500">Contribute data, earn airtime rewards</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Create your account</h1>
                <p className="text-sm text-gray-500">Free to start — no credit card required</p>
              </>
            )}
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
                className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
                placeholder="Jane Smith"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                autoComplete="email"
                className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
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
                  className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
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
                  className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className={`w-full flex items-center justify-center gap-2 ${accentClasses.btn} disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl py-3 transition-colors shadow-lg mt-1`}>
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Creating account…</>
                : isAnnotatorMode
                ? <>Join as Contributor <Gift size={14} /></>
                : <>Create free account <ArrowRight size={14} /></>}
            </button>

            <p className="text-[11px] text-gray-600 text-center leading-relaxed">
              By creating an account you agree to our{' '}
              <span className="text-gray-500">Terms of Service</span> and{' '}
              <span className="text-gray-500">Privacy Policy</span>.
            </p>
          </form>

          {isAnnotatorMode && (
            <div className="mt-4 p-3 bg-gray-900/50 border border-gray-800 rounded-xl text-center">
              <p className="text-xs text-gray-500">
                Already a contributor?{' '}
                <button onClick={onGoLogin} className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
                  Sign in
                </button>
              </p>
              <p className="text-xs text-gray-600 mt-1.5">
                Want to build ML models instead?{' '}
                <a
                  href={window.location.pathname}
                  className="text-sky-400 hover:text-sky-300 transition-colors"
                  onClick={e => { e.preventDefault(); window.history.replaceState({}, '', window.location.pathname); window.location.reload() }}
                >
                  Register as engineer
                </a>
              </p>
            </div>
          )}

          {!isAnnotatorMode && (
            <p className="text-center text-xs text-gray-600 mt-6">
              Already have an account?{' '}
              <button onClick={onGoLogin} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>

    </div>
  )
}
