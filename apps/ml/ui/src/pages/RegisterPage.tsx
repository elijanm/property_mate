import { useState, useEffect, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  Eye, EyeOff, Loader2, ArrowRight, Cpu, Zap, Database, Layers,
  Gift, Star, Camera, ChevronRight, CheckCircle2, Monitor,
  CloudLightning, BarChart2, ArrowLeft,
} from 'lucide-react'
import Logo from '@/components/Logo'
import { annotatorApi } from '@/api/annotator'
import { adminApi } from '@/api/admin'
import { authApi } from '@/api/auth'
import type { MLPlan } from '@/types/plan'
import clsx from 'clsx'
import DisposableEmailModal from '@/components/DisposableEmailModal'

interface Props { onGoLogin: () => void; onGoHome?: () => void; initialRole?: 'engineer' | 'annotator' }

// Detect annotator signup mode from URL params
const _searchParams = new URLSearchParams(window.location.search)
const _URL_ROLE = _searchParams.get('role')
const _URL_REF = _searchParams.get('ref')
const _IS_ANNOTATOR_MODE = _URL_ROLE === 'annotator' || !!_URL_REF

const FALLBACK_PLANS: MLPlan[] = [
  { id: 'f1', name: 'Starter', description: '', price_usd_per_month: 0, included_period: 'month', included_cpu_hours: 0, included_local_gpu_hours: 0, included_cloud_gpu_credit_usd: 0, free_inference_calls: 500, free_inference_period: 'month', new_customer_credit_usd: 5, is_active: true, is_default: true, created_at: null, updated_at: null },
  { id: 'f2', name: 'Developer', description: '', price_usd_per_month: 19, included_period: 'month', included_cpu_hours: 30, included_local_gpu_hours: 10, included_cloud_gpu_credit_usd: 2, free_inference_calls: 2000, free_inference_period: 'month', new_customer_credit_usd: 10, is_active: true, is_default: false, created_at: null, updated_at: null },
  { id: 'f3', name: 'Pro', description: '', price_usd_per_month: 79, included_period: 'month', included_cpu_hours: 100, included_local_gpu_hours: 40, included_cloud_gpu_credit_usd: 8, free_inference_calls: 10000, free_inference_period: 'month', new_customer_credit_usd: 25, is_active: true, is_default: false, created_at: null, updated_at: null },
]

const ANNOTATOR_PERKS = [
  { icon: <Camera size={16} className="text-sky-400" />, color: 'border-sky-800/40 bg-sky-950/30', iconBg: 'bg-sky-900/40', title: 'Capture real-world data', desc: 'Take photos, fill forms, and contribute to AI training datasets.' },
  { icon: <Gift size={16} className="text-emerald-400" />, color: 'border-emerald-800/40 bg-emerald-950/30', iconBg: 'bg-emerald-900/40', title: 'Earn redeemable points', desc: 'Complete approved tasks to earn points — redeemable for rewards.' },
  { icon: <Star size={16} className="text-amber-400" />, color: 'border-amber-800/40 bg-amber-950/30', iconBg: 'bg-amber-900/40', title: 'Work at your own pace', desc: 'Pick tasks that fit your schedule and location.' },
  { icon: <Layers size={16} className="text-violet-400" />, color: 'border-violet-800/40 bg-violet-950/30', iconBg: 'bg-violet-900/40', title: 'Variety of tasks', desc: 'Agriculture, livestock, documents, traffic, and more categories.' },
]

const PERK_CARDS = [
  { icon: <Cpu size={16} className="text-sky-400" />, color: 'border-sky-800/40 bg-sky-950/30', iconBg: 'bg-sky-900/40', title: 'Standard compute included', desc: 'Train on our server from day one — no card, no setup required.' },
  { icon: <Zap size={16} className="text-emerald-400" />, color: 'border-emerald-800/40 bg-emerald-950/30', iconBg: 'bg-emerald-900/40', title: 'Live REST API on first deploy', desc: 'Signed keys, model versioning, zero-downtime rollback.' },
  { icon: <Database size={16} className="text-violet-400" />, color: 'border-violet-800/40 bg-violet-950/30', iconBg: 'bg-violet-900/40', title: 'Wallet billing — no surprises', desc: 'Pre-fund locally, spend on GPU time. Never post-billed.' },
  { icon: <Layers size={16} className="text-amber-400" />, color: 'border-amber-800/40 bg-amber-950/30', iconBg: 'bg-amber-900/40', title: 'Any Python framework', desc: 'sklearn, PyTorch, YOLO, transformers — bring your existing code.' },
]

type Step = 'role' | 'pricing' | 'form'

function initStep(initialRole: 'engineer' | 'annotator' | undefined): Step {
  if (_IS_ANNOTATOR_MODE || initialRole === 'annotator') return 'form'
  if (initialRole === 'engineer') return 'pricing'
  return 'role'
}

export default function RegisterPage({ onGoLogin, onGoHome, initialRole }: Props) {
  const { register } = useAuth()
  const [step, setStep] = useState<Step>(initStep(initialRole))
  const [isAnnotatorMode, setIsAnnotatorMode] = useState(_IS_ANNOTATOR_MODE || initialRole === 'annotator')
  const [selectedPlan, setSelectedPlan] = useState<MLPlan | null>(null)
  const [plans, setPlans] = useState<MLPlan[]>(FALLBACK_PLANS)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [annotatorSuccess, setAnnotatorSuccess] = useState(false)
  const [couponCode, setCouponCode] = useState('')
  const [couponStatus, setCouponStatus] = useState<{ valid: boolean; credit_usd?: number; credit_type?: 'standard' | 'accelerated' } | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)
  const [showDisposableModal, setShowDisposableModal] = useState(false)
  const [disposableAttempts, setDisposableAttempts] = useState(0)
  const [pendingSubmit, setPendingSubmit] = useState(false)

  useEffect(() => {
    adminApi.getPublicPricing().then(data => {
      if (data.plans?.length) setPlans(data.plans)
    }).catch(() => {})
  }, [])

  async function checkCoupon(code: string) {
    if (!code.trim()) { setCouponStatus(null); return }
    setCouponChecking(true)
    try {
      const result = await authApi.validateCoupon(code.trim())
      setCouponStatus(result)
    } catch { setCouponStatus({ valid: false }) }
    finally { setCouponChecking(false) }
  }

  async function doRegister(emailOverride?: string) {
    setLoading(true)
    const useEmail = emailOverride ?? email
    try {
      if (isAnnotatorMode) {
        await annotatorApi.register(useEmail, password, fullName, _URL_REF ?? undefined)
        setAnnotatorSuccess(true)
      } else {
        await register(useEmail, password, fullName, couponCode.trim().toUpperCase() || undefined)
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? (err instanceof Error ? err.message : 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')

    // Check email before registering
    setLoading(true)
    try {
      const check = await authApi.checkEmail(email)
      if (check.is_disposable && check.confidence !== 'unavailable') {
        setDisposableAttempts(0)
        setPendingSubmit(true)
        setShowDisposableModal(true)
        setLoading(false)
        return
      }
    } catch { /* unavailable — proceed */ }
    setLoading(false)

    await doRegister()
  }

  async function handleDisposableUseReal(realEmail: string) {
    try {
      const check = await authApi.checkEmail(realEmail)
      if (check.is_disposable && check.confidence !== 'unavailable') {
        const next = disposableAttempts + 1
        setDisposableAttempts(next)
        return { is_disposable: true, attempts: next }
      }
    } catch { /* unavailable — proceed */ }
    setShowDisposableModal(false)
    setPendingSubmit(false)
    setEmail(realEmail)
    // Register with the clean email directly
    setLoading(true)
    try {
      if (isAnnotatorMode) {
        await annotatorApi.register(realEmail, password, fullName, _URL_REF ?? undefined)
        setAnnotatorSuccess(true)
      } else {
        await register(realEmail, password, fullName)
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? (err instanceof Error ? err.message : 'Registration failed'))
    } finally {
      setLoading(false)
    }
    return { is_disposable: false, attempts: 0 }
  }

  async function handleDisposableKeep() {
    setShowDisposableModal(false)
    setPendingSubmit(false)
    if (pendingSubmit) await doRegister()
  }

  const perks = isAnnotatorMode ? ANNOTATOR_PERKS : PERK_CARDS
  const accentClasses = isAnnotatorMode
    ? { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', dot: 'bg-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30', focus: 'focus:border-emerald-500' }
    : { border: 'border-sky-500/20', bg: 'bg-sky-500/5', text: 'text-sky-400', dot: 'bg-sky-400', btn: 'bg-sky-600 hover:bg-sky-500 shadow-sky-900/30', focus: 'focus:border-sky-500' }

  // ── Disposable email modal (rendered at top level, overlays any step) ───────
  const disposableModal = showDisposableModal && (
    <DisposableEmailModal
      suspectedEmail={email}
      attempts={disposableAttempts}
      onUseReal={handleDisposableUseReal}
      onKeep={handleDisposableKeep}
    />
  )

  // ── Success screen ──────────────────────────────────────────────────────────
  if (annotatorSuccess) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">🎉</div>
          <div className="text-white font-bold text-xl">You're in!</div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Check your email to verify your account. Once verified, log in and start earning redeemable points by contributing data.
          </p>
          {_URL_REF && (
            <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
              Referral code <strong>{_URL_REF}</strong> has been applied!
            </div>
          )}
          <button onClick={onGoLogin} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors">
            Sign in
          </button>
        </div>
      </div>
    )
  }

  // ── Step 1: Role picker ─────────────────────────────────────────────────────
  if (step === 'role') {
    return (
      <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center p-6">
        {disposableModal}
        <div className="mb-10">
          <button onClick={onGoHome} className="outline-none">
            <Logo size="md" />
          </button>
        </div>

        <div className="w-full max-w-2xl text-center mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">How will you use MLDock?</h1>
          <p className="text-sm text-gray-500">Choose your role to get started</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 w-full max-w-2xl">
          {/* Engineer card */}
          <button
            onClick={() => { setIsAnnotatorMode(false); setStep('pricing') }}
            className="group text-left rounded-2xl border border-sky-800/40 bg-sky-950/20 hover:border-sky-600/60 hover:bg-sky-950/40 p-8 space-y-4 transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-sky-900/50 border border-sky-700/40 flex items-center justify-center">
              <Cpu size={24} className="text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base font-bold text-white">Build &amp; Deploy Models</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-900/50 border border-sky-700/40 text-sky-300">Engineer</span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                Train, deploy and monitor ML models. Bring your Python trainer code — any framework supported.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-sky-400 text-sm font-medium group-hover:gap-2.5 transition-all">
              Get started <ChevronRight size={14} />
            </div>
          </button>

          {/* Contributor card */}
          <button
            onClick={() => { setIsAnnotatorMode(true); setStep('form') }}
            className="group text-left rounded-2xl border border-emerald-800/40 bg-emerald-950/20 hover:border-emerald-600/60 hover:bg-emerald-950/40 p-8 space-y-4 transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-900/50 border border-emerald-700/40 flex items-center justify-center">
              <Camera size={24} className="text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base font-bold text-white">Contribute Data</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-900/50 border border-emerald-700/40 text-emerald-300">Contributor</span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                Capture photos, fill forms, and earn redeemable points while helping build AI datasets. Work at your own pace.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium group-hover:gap-2.5 transition-all">
              Join programme <ChevronRight size={14} />
            </div>
          </button>
        </div>

        <p className="mt-10 text-sm text-gray-600">
          Already have an account?{' '}
          <button onClick={onGoLogin} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
            Sign in instead
          </button>
        </p>
      </div>
    )
  }

  // ── Step 2 (Engineer only): Plan picker ─────────────────────────────────────
  if (step === 'pricing') {
    const planGridClass = plans.length <= 1 ? 'max-w-sm'
      : plans.length === 2 ? 'grid-cols-2 max-w-2xl'
      : 'grid-cols-1 sm:grid-cols-3 max-w-5xl'

    return (
      <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-start p-6 pt-10 pb-16">
        {disposableModal}
        {/* Logo + back */}
        <div className="w-full max-w-5xl flex items-center justify-between mb-10">
          <button onClick={onGoHome} className="outline-none">
            <Logo size="sm" />
          </button>
          <button onClick={() => setStep('role')} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            <ArrowLeft size={13} /> Back
          </button>
        </div>

        <div className="text-center mb-10">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Pricing</p>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">Choose your plan</h1>
          <p className="text-sm text-gray-500 max-w-lg mx-auto">
            Start free, upgrade when you need more compute. You can always change your plan later.
          </p>
        </div>

        <div className={clsx('grid gap-5 mx-auto w-full', planGridClass)}>
          {plans.map((plan, idx) => {
            const isFree = plan.price_usd_per_month === 0
            const isHighlight = !isFree && idx === 1
            const isSelected = selectedPlan?.id === plan.id
            const period = plan.included_period ?? 'month'
            const periodLabel = period === 'month' ? '/mo' : `/${period}`
            const val = (plan as unknown as Record<string, unknown>).included_compute_value_usd as number | undefined
            return (
              <div
                key={plan.id ?? plan.name}
                onClick={() => setSelectedPlan(plan)}
                className={clsx(
                  'rounded-2xl border p-6 flex flex-col relative cursor-pointer transition-all',
                  isSelected
                    ? 'border-sky-500 bg-sky-950/30 ring-2 ring-sky-500/40'
                    : isHighlight
                    ? 'border-sky-500/40 bg-sky-950/15 hover:border-sky-500/70'
                    : 'border-white/6 bg-gray-900/40 hover:border-white/15',
                )}
              >
                {isHighlight && !isSelected && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-sky-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                    Most popular
                  </div>
                )}
                {isSelected && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-sky-500 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                    <CheckCircle2 size={10} /> Selected
                  </div>
                )}

                <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{plan.name}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-white">
                    {isFree ? 'Free' : `$${plan.price_usd_per_month}`}
                  </span>
                  {!isFree && <span className="text-sm text-gray-500">{periodLabel}</span>}
                </div>

                {val != null && val > 0 && (
                  <div className="text-[11px] text-emerald-400 mb-4">~${val} compute included{periodLabel}</div>
                )}
                {isFree && <div className="text-[11px] text-gray-600 mb-4">pay only for what you use</div>}

                <div className="space-y-1.5 mb-5 border-t border-white/5 pt-4">
                  {plan.included_cpu_hours > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-gray-400"><Monitor size={10} className="text-sky-400" /> CPU training</span>
                      <span className="text-sky-300 font-medium">{plan.included_cpu_hours}h{periodLabel}</span>
                    </div>
                  )}
                  {plan.included_local_gpu_hours > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-gray-400"><Zap size={10} className="text-violet-400" /> Local GPU</span>
                      <span className="text-violet-300 font-medium">{plan.included_local_gpu_hours}h{periodLabel}</span>
                    </div>
                  )}
                  {plan.included_cloud_gpu_credit_usd > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-gray-400"><CloudLightning size={10} className="text-amber-400" /> Cloud GPU credit</span>
                      <span className="text-amber-300 font-medium">${plan.included_cloud_gpu_credit_usd}{periodLabel}</span>
                    </div>
                  )}
                  {plan.free_inference_calls > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-gray-400"><BarChart2 size={10} className="text-blue-400" /> Inference calls</span>
                      <span className="text-blue-300 font-medium">{plan.free_inference_calls.toLocaleString()}{periodLabel}</span>
                    </div>
                  )}
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.new_customer_credit_usd > 0 && (
                    <li className="flex items-start gap-2 text-xs text-gray-400">
                      <CheckCircle2 size={10} className="text-green-400 flex-shrink-0 mt-0.5" />
                      ${plan.new_customer_credit_usd} welcome credit (one-time)
                    </li>
                  )}
                  <li className="flex items-start gap-2 text-xs text-gray-400">
                    <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> REST API deployment
                  </li>
                  <li className="flex items-start gap-2 text-xs text-gray-400">
                    <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Experiment tracking (MLflow)
                  </li>
                  <li className="flex items-start gap-2 text-xs text-gray-400">
                    <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Cloud GPU access (pay-as-you-go)
                  </li>
                </ul>

                <button
                  onClick={e => { e.stopPropagation(); setSelectedPlan(plan); setStep('form') }}
                  className={clsx(
                    'w-full py-2.5 text-sm font-semibold rounded-xl transition-colors',
                    isSelected || isHighlight
                      ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/40'
                      : 'border border-white/10 hover:border-white/20 text-gray-400 hover:text-white',
                  )}
                >
                  {isFree ? 'Start free' : 'Choose plan'}
                </button>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-gray-600 mt-8">
          All plans: API keys · model versioning · monitoring · A/B testing · no AWS account required
        </p>
        <p className="text-center text-xs text-gray-700 mt-2">
          You can change or upgrade your plan at any time after signing up.
        </p>
      </div>
    )
  }

  // ── Step 3: Registration form ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#060810] flex">
      {disposableModal}

      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 bg-[#060d1a] border-r border-white/5 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className={`absolute top-0 left-0 w-[500px] h-[500px] rounded-full ${isAnnotatorMode ? 'bg-emerald-600/8' : 'bg-sky-600/8'} blur-[120px]`} />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-violet-600/6 blur-[100px]" />
        </div>

        <div className="relative">
          <button onClick={onGoHome} className="outline-none">
            <Logo size="md" />
          </button>
        </div>

        <div className="relative space-y-8">
          <div>
            {isAnnotatorMode ? (
              <>
                <h2 className="text-3xl font-bold text-white leading-snug tracking-tight mb-3">
                  Join as a<br /><span className="text-emerald-400">Data Contributor</span>
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
                  Take photos, fill forms, and earn redeemable points while helping build AI datasets. Work at your own pace, from anywhere.
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
                  Start training models<br /><span className="text-sky-400">in minutes.</span>
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
                  No AWS account. No infrastructure setup. No credit card required. Write your trainer, drop the file, and your first model is live.
                </p>
                {selectedPlan && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 text-xs font-medium">
                    <CheckCircle2 size={11} /> {selectedPlan.name} plan selected
                  </div>
                )}
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
            {isAnnotatorMode ? 'Earn redeemable points for every contribution' : 'Open beta — free to start today'}
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
          {/* Step back link */}
          <button
            onClick={() => setStep(isAnnotatorMode ? 'role' : 'pricing')}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors mb-6"
          >
            <ArrowLeft size={12} /> {isAnnotatorMode ? 'Change role' : 'Change plan'}
          </button>

          <div className="mb-8">
            {isAnnotatorMode ? (
              <>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 text-xs font-semibold mb-3">
                  🏆 Data Contributor Programme
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Join &amp; start contributing</h1>
                <p className="text-sm text-gray-500">Contribute data, earn redeemable points</p>
              </>
            ) : (
              <>
                {selectedPlan && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-900/30 border border-sky-700/40 text-sky-400 text-xs font-semibold mb-3">
                    <CheckCircle2 size={11} /> {selectedPlan.name} plan
                    {selectedPlan.price_usd_per_month === 0 ? ' — Free' : ` — $${selectedPlan.price_usd_per_month}/mo`}
                  </div>
                )}
                <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Create your account</h1>
                <p className="text-sm text-gray-500">Free to start — no credit card required</p>
              </>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">{error}</div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Full name</label>
              <input
                type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                autoComplete="name"
                className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
                placeholder="Jane Smith"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                autoComplete="email"
                className={`w-full bg-white/5 border border-white/10 hover:border-white/20 ${accentClasses.focus} rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors`}
                placeholder="you@example.com"
              />
            </div>

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

            {/* Coupon code — engineers only */}
            {!isAnnotatorMode && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">Coupon code <span className="text-gray-600">(optional)</span></label>
                <div className="flex gap-2">
                  <input
                    type="text" value={couponCode}
                    onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponStatus(null) }}
                    onBlur={() => checkCoupon(couponCode)}
                    placeholder="LAUNCH50"
                    className={`flex-1 bg-white/5 border rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors ${
                      couponStatus?.valid === true ? 'border-emerald-500 focus:border-emerald-400' :
                      couponStatus?.valid === false ? 'border-red-700 focus:border-red-600' :
                      'border-white/10 hover:border-white/20 focus:border-sky-500'
                    }`}
                  />
                  <button type="button" onClick={() => checkCoupon(couponCode)} disabled={couponChecking || !couponCode.trim()}
                    className="px-3 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-400 hover:text-white disabled:opacity-40 transition-colors">
                    {couponChecking ? '…' : 'Apply'}
                  </button>
                </div>
                {couponStatus?.valid === true && (
                  <p className="text-xs text-emerald-400">
                    ✓ ${couponStatus.credit_usd} {couponStatus.credit_type === 'accelerated' ? '⚡ accelerated compute' : '🖥 standard compute'} credit will be added after email verification
                  </p>
                )}
                {couponStatus?.valid === false && (
                  <p className="text-xs text-red-400">✗ Invalid or expired coupon code</p>
                )}
              </div>
            )}

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
                <button onClick={onGoLogin} className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">Sign in</button>
              </p>
              <p className="text-xs text-gray-600 mt-1.5">
                Want to build ML models instead?{' '}
                <button onClick={() => { setIsAnnotatorMode(false); setStep('pricing') }} className="text-sky-400 hover:text-sky-300 transition-colors">
                  Register as engineer
                </button>
              </p>
            </div>
          )}

          {!isAnnotatorMode && (
            <p className="text-center text-xs text-gray-600 mt-6">
              Already have an account?{' '}
              <button onClick={onGoLogin} className="text-sky-400 hover:text-sky-300 font-medium transition-colors">Sign in</button>
            </p>
          )}
        </div>
      </div>

    </div>
  )
}
