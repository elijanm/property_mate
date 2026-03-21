import { useState, useEffect } from 'react'
import client from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import {
  DollarSign, Wallet, Zap, Cpu, BarChart2, CheckCircle2,
  Loader2, AlertCircle, Monitor, CloudLightning, RefreshCw,
  TrendingUp, Receipt, ArrowUpRight, X, ExternalLink,
  CreditCard, Clock, ChevronDown, ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'

interface PlanInfo {
  id: string
  name: string
  description: string
  price_usd_per_month: number
  included_period: string
  included_cpu_hours: number
  included_local_gpu_hours: number
  included_cloud_gpu_credit_usd: number
  free_inference_calls: number
  free_inference_period: string
  new_customer_credit_usd: number
  is_default: boolean
  included_compute_value_usd?: number
}

interface UsageInfo {
  plan_name: string
  free_training_used_hours: number
  free_training_period_reset_at: string | null
  free_inference_used: number
  free_inference_period_reset_at: string | null
  new_customer_credit_given: boolean
  new_customer_credit_amount: number
}

interface WalletInfo {
  balance: number
  standard_balance: number
  general_balance: number
  reserved: number
  currency: string
}

interface MyPlanData {
  current_plan: PlanInfo | null
  usage: UsageInfo | null
  wallet: WalletInfo | null
  available_plans: PlanInfo[]
  pricing: { cpu_per_hour: number; gpu_per_hour: number; inference_per_call: number }
}

interface ProrationInfo {
  days_remaining: number
  days_in_month: number
  proration_fraction: number
  credit_usd: number
  charge_usd: number
  net_usd: number
}

interface Transaction {
  id: string
  type: string
  amount: number
  standard_amount: number
  balance_after: number
  description: string
  reference: string | null
  job_id: string | null
  created_at: string
}

interface RevenueEntry {
  id: string
  type: string
  amount_usd: number
  user_email: string
  plan_name: string | null
  description: string
  reference: string | null
  created_at: string
}

interface RevenueSummary {
  total_usd: number
  breakdown: Record<string, number>
  labels: Record<string, string>
  recent: RevenueEntry[]
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-brand-500'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">{used.toFixed(1)} / {total}h</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Payment modal ──────────────────────────────────────────────────────────

function PaymentModal({
  plan,
  currentPlanPrice,
  onClose,
  onSuccess,
}: {
  plan: PlanInfo
  currentPlanPrice: number
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState<'preview' | 'paying' | 'verifying' | 'done'>('preview')
  const [proration, setProration] = useState<ProrationInfo | null>(null)
  const [authUrl, setAuthUrl] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Compute proration locally for preview (matches backend logic)
  useEffect(() => {
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysRemaining = daysInMonth - now.getDate() + 1
    const frac = daysRemaining / daysInMonth
    const credit = Math.round(currentPlanPrice * frac * 100) / 100
    const charge = Math.round(plan.price_usd_per_month * frac * 100) / 100
    const net = Math.round((charge - credit) * 100) / 100
    setProration({ days_remaining: daysRemaining, days_in_month: daysInMonth, proration_fraction: frac, credit_usd: credit, charge_usd: charge, net_usd: net })
  }, [plan, currentPlanPrice])

  const handleInitiate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await client.post('/billing/initiate-plan-upgrade', {
        plan_id: plan.id,
        callback_url: window.location.href,
      })
      const data = res.data
      if (data.free) {
        onSuccess()
        return
      }
      setReference(data.reference)
      setAuthUrl(data.authorization_url)
      setStep('paying')
      // Open Paystack in new tab
      window.open(data.authorization_url, '_blank')
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to initiate payment')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!reference) return
    setLoading(true)
    setError('')
    setStep('verifying')
    try {
      await client.post('/billing/verify-plan-upgrade', { reference, plan_id: plan.id })
      setStep('done')
      setTimeout(() => { onSuccess(); onClose() }, 1500)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Payment verification failed')
      setStep('paying')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="text-brand-400" />
            <span className="text-sm font-semibold text-white">Upgrade to {plan.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {step === 'done' && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm py-4 justify-center">
              <CheckCircle2 size={18} /> Plan upgraded successfully!
            </div>
          )}

          {step !== 'done' && (
            <>
              {/* Plan summary */}
              <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">{plan.name} plan</span>
                  <span className="text-white font-bold">${plan.price_usd_per_month}/mo</span>
                </div>
                {proration && (
                  <>
                    <div className="h-px bg-gray-700 my-2" />
                    <div className="text-xs text-gray-500 space-y-1.5">
                      <div className="flex justify-between">
                        <span>{proration.days_remaining} days remaining in month</span>
                        <span>${proration.charge_usd}</span>
                      </div>
                      {currentPlanPrice > 0 && (
                        <div className="flex justify-between text-emerald-400">
                          <span>Credit for unused days on current plan</span>
                          <span>−${proration.credit_usd}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-white font-medium border-t border-gray-700 pt-1.5 mt-1.5">
                        <span>Due today (prorated)</span>
                        <span>${Math.max(proration.net_usd, 0)}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {step === 'preview' && (
                <button
                  onClick={handleInitiate}
                  disabled={loading}
                  className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={13} />}
                  Pay via Paystack
                </button>
              )}

              {step === 'paying' && (
                <div className="space-y-3">
                  <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900 rounded-lg px-3 py-2 flex items-center gap-2">
                    <Clock size={12} /> Complete payment in the opened Paystack window, then click verify below.
                  </div>
                  {authUrl && (
                    <button
                      onClick={() => window.open(authUrl, '_blank')}
                      className="w-full py-2 text-xs text-brand-400 border border-brand-800 rounded-lg hover:bg-brand-950/30 flex items-center justify-center gap-1"
                    >
                      <ExternalLink size={11} /> Re-open payment page
                    </button>
                  )}
                  <button
                    onClick={handleVerify}
                    disabled={loading}
                    className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    I've paid — verify &amp; activate plan
                  </button>
                </div>
              )}

              {step === 'verifying' && (
                <div className="flex items-center justify-center gap-2 py-4 text-gray-400 text-sm">
                  <Loader2 size={16} className="animate-spin" /> Verifying payment…
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Plan card ──────────────────────────────────────────────────────────────

function PlanCard({
  plan, isCurrent, currentPlanPrice, onSelect, switching,
}: {
  plan: PlanInfo
  isCurrent: boolean
  currentPlanPrice: number
  onSelect: (plan: PlanInfo) => void
  switching: string | null
}) {
  const isFree = plan.price_usd_per_month === 0
  const periodLabel = plan.included_period === 'month' ? '/mo' : `/${plan.included_period}`
  const isLoading = switching === plan.id

  return (
    <div className={clsx(
      'rounded-xl border p-5 flex flex-col gap-4 relative transition-all',
      isCurrent
        ? 'border-brand-500/60 bg-brand-950/20 ring-1 ring-brand-500/20'
        : 'border-gray-800 bg-gray-900/60 hover:border-gray-700',
    )}>
      {isCurrent && (
        <div className="absolute -top-3 left-4 bg-brand-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
          Current plan
        </div>
      )}
      <div>
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">{plan.name}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-white">{isFree ? 'Free' : `$${plan.price_usd_per_month}`}</span>
          {!isFree && <span className="text-sm text-gray-500">{periodLabel}</span>}
        </div>
        {plan.included_compute_value_usd != null && plan.included_compute_value_usd > 0 && (
          <div className="text-[11px] text-emerald-400 mt-0.5">~${plan.included_compute_value_usd} compute included{periodLabel}</div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-white/5 pt-3">
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
        {plan.new_customer_credit_usd > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 size={10} /> ${plan.new_customer_credit_usd} welcome credit (one-time)
          </div>
        )}
      </div>

      {!isCurrent && (
        <button
          onClick={() => onSelect(plan)}
          disabled={!!switching}
          className={clsx(
            'mt-auto w-full py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-40 flex items-center justify-center gap-2',
            isFree
              ? 'border-gray-700 text-gray-400 hover:bg-gray-800'
              : 'border-brand-700 text-brand-400 hover:bg-brand-900/30',
          )}
        >
          {isLoading && <Loader2 size={12} className="animate-spin" />}
          {isFree ? 'Switch to free' : <>Upgrade <ArrowUpRight size={12} /></>}
        </button>
      )}
    </div>
  )
}

// ── Revenue breakdown (admin) ──────────────────────────────────────────────

function RevenuePanel() {
  const [data, setData] = useState<RevenueSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    client.get('/billing/revenue')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center gap-2 text-gray-600 text-xs py-2"><Loader2 size={12} className="animate-spin" /> Loading revenue…</div>
  if (!data) return null

  const positiveTypes = Object.entries(data.breakdown).filter(([, v]) => v > 0)
  const negativeTypes = Object.entries(data.breakdown).filter(([, v]) => v < 0)

  const TYPE_COLORS: Record<string, string> = {
    plan_subscription:  'text-brand-400',
    wallet_topup:       'text-emerald-400',
    gpu_standard:       'text-sky-400',
    gpu_accelerated:    'text-violet-400',
    inference_openai:   'text-amber-400',
    inference_local:    'text-orange-400',
    free_credit_grant:  'text-red-400',
    proration_credit:   'text-red-300',
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp size={14} className="text-brand-400" />
        <span className="text-sm font-semibold text-white">Revenue</span>
        <span className="ml-auto text-lg font-bold text-white">${data.total_usd.toFixed(2)}</span>
        <span className="text-xs text-gray-500">USD total</span>
      </div>

      {/* Breakdown bars */}
      <div className="space-y-2.5">
        {positiveTypes.map(([type, amount]) => {
          const pct = data.total_usd > 0 ? Math.min((amount / data.total_usd) * 100, 100) : 0
          return (
            <div key={type} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className={clsx(TYPE_COLORS[type] ?? 'text-gray-400')}>{data.labels[type] ?? type}</span>
                <span className="text-gray-300 font-mono">${amount.toFixed(2)}</span>
              </div>
              <div className="h-1 bg-gray-800 rounded-full">
                <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
        {negativeTypes.map(([type, amount]) => (
          <div key={type} className="flex justify-between text-xs">
            <span className={clsx(TYPE_COLORS[type] ?? 'text-red-400')}>{data.labels[type] ?? type}</span>
            <span className="text-red-400 font-mono">${amount.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Recent entries toggle */}
      {data.recent.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Recent transactions ({data.recent.length})
          </button>
          {expanded && (
            <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
              {data.recent.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800/60">
                  <span className={clsx(e.amount_usd >= 0 ? 'text-emerald-400' : 'text-red-400', 'font-mono w-16 shrink-0')}>
                    {e.amount_usd >= 0 ? '+' : ''}${e.amount_usd.toFixed(2)}
                  </span>
                  <span className="text-gray-500 truncate flex-1">{e.description}</span>
                  <span className="text-gray-700 shrink-0">{new Date(e.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Credit log ─────────────────────────────────────────────────────────────

function CreditLog() {
  const [txns, setTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    client.get('/billing/credit-log')
      .then(r => setTxns(r.data.transactions))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const TX_COLOR: Record<string, string> = {
    credit: 'text-emerald-400',
    debit: 'text-red-400',
    reserve: 'text-amber-400',
    release: 'text-sky-400',
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Receipt size={14} className="text-brand-400" />
        <span className="text-sm font-semibold text-white">Wallet history</span>
        <button onClick={() => setExpanded(e => !e)} className="ml-auto text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Collapse' : 'Show'}
        </button>
      </div>

      {expanded && (
        loading ? (
          <div className="flex items-center gap-2 text-gray-600 text-xs"><Loader2 size={12} className="animate-spin" /> Loading…</div>
        ) : txns.length === 0 ? (
          <p className="text-xs text-gray-600">No transactions yet.</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {txns.map(t => (
              <div key={t.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-gray-800/60">
                <span className={clsx('font-mono w-20 shrink-0 pt-0.5', TX_COLOR[t.type] ?? 'text-gray-400')}>
                  {t.type === 'credit' ? '+' : t.type === 'debit' ? '−' : ''}${Math.abs(t.amount).toFixed(4)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-300 truncate">{t.description}</div>
                  <div className="text-gray-600">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <span className="text-gray-700 shrink-0 font-mono">${t.balance_after.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function UserBillingPage() {
  const { user } = useAuth()
  const [data, setData] = useState<MyPlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchMsg, setSwitchMsg] = useState('')
  const [paymentPlan, setPaymentPlan] = useState<PlanInfo | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await client.get('/billing/my-plan')
      setData(res.data)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load billing info')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSelectPlan = (plan: PlanInfo) => {
    setSwitchMsg('')
    if (plan.price_usd_per_month === 0) {
      // Free plan — direct switch
      setSwitching(plan.id)
      client.post('/billing/initiate-plan-upgrade', { plan_id: plan.id })
        .then(() => { setSwitchMsg('Plan updated successfully.'); load() })
        .catch(e => setSwitchMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to switch plan.'))
        .finally(() => setSwitching(null))
    } else {
      setPaymentPlan(plan)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-brand-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 bg-red-950/30 border border-red-900 rounded-xl p-4 text-red-400 text-sm max-w-lg">
        <AlertCircle size={16} className="flex-shrink-0" /> {error}
      </div>
    )
  }

  if (!data) return null

  const { current_plan, usage, wallet, available_plans, pricing } = data
  const currentPlanId = current_plan?.id ?? null
  const currentPlanPrice = current_plan?.price_usd_per_month ?? 0

  return (
    <div className="max-w-4xl space-y-8">
      {paymentPlan && (
        <PaymentModal
          plan={paymentPlan}
          currentPlanPrice={currentPlanPrice}
          onClose={() => setPaymentPlan(null)}
          onSuccess={() => { setPaymentPlan(null); setSwitchMsg('Plan upgraded successfully.'); load() }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Billing &amp; Plan</h2>
          <p className="text-xs text-gray-500 mt-0.5">{user?.email}</p>
        </div>
        <button onClick={load} className="text-gray-600 hover:text-gray-400 transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Wallet + current plan summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Wallet */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} className="text-brand-400" />
            <span className="text-sm font-semibold text-white">Wallet Balance</span>
          </div>
          {wallet ? (
            <>
              <div className="text-3xl font-bold text-white">${wallet.balance.toFixed(2)} <span className="text-sm font-normal text-gray-500">{wallet.currency}</span></div>
              {wallet.reserved > 0 && (
                <div className="text-xs text-amber-400">${wallet.reserved.toFixed(2)} reserved for running jobs</div>
              )}
              <div className="flex gap-4 pt-1 border-t border-gray-800 text-xs">
                {wallet.standard_balance > 0 && (
                  <span className="text-sky-400">${wallet.standard_balance.toFixed(2)} standard</span>
                )}
                {wallet.general_balance > 0 && (
                  <span className="text-violet-400">${wallet.general_balance.toFixed(2)} accelerated</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">No wallet found</p>
          )}
        </div>

        {/* Current plan summary */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-brand-400" />
            <span className="text-sm font-semibold text-white">Current Plan</span>
          </div>
          {current_plan ? (
            <>
              <div className="text-2xl font-bold text-white">
                {current_plan.price_usd_per_month === 0 ? 'Free' : `$${current_plan.price_usd_per_month}/mo`}
                <span className="ml-2 text-sm font-normal text-gray-400">{current_plan.name}</span>
              </div>
              {usage?.new_customer_credit_given === false && current_plan.new_customer_credit_usd > 0 && (
                <div className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={10} /> ${current_plan.new_customer_credit_usd} welcome credit pending
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">No plan assigned — pay-as-you-go rates apply.</div>
          )}
          <div className="text-xs text-gray-600 border-t border-gray-800 pt-2">
            CPU: ${pricing.cpu_per_hour}/hr · GPU: ${pricing.gpu_per_hour}/hr · Inference: ${pricing.inference_per_call}/call
          </div>
        </div>
      </div>

      {/* Usage */}
      {usage && current_plan && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-brand-400" />
            <span className="text-sm font-semibold text-white">Plan Usage</span>
            {usage.free_training_period_reset_at && (
              <span className="ml-auto text-[10px] text-gray-600">
                Resets {new Date(usage.free_training_period_reset_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {current_plan.included_cpu_hours > 0 && (
              <UsageBar
                used={usage.free_training_used_hours}
                total={current_plan.included_cpu_hours}
                label="CPU training hours"
              />
            )}
            {current_plan.free_inference_calls > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Inference calls</span>
                  <span className="text-gray-300 font-mono">
                    {usage.free_inference_used.toLocaleString()} / {current_plan.free_inference_calls.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      (usage.free_inference_used / current_plan.free_inference_calls) > 0.85 ? 'bg-red-500'
                      : (usage.free_inference_used / current_plan.free_inference_calls) > 0.6 ? 'bg-amber-500'
                      : 'bg-brand-500',
                    )}
                    style={{ width: `${Math.min((usage.free_inference_used / current_plan.free_inference_calls) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
            {current_plan.included_cpu_hours === 0 && current_plan.free_inference_calls === 0 && (
              <p className="text-xs text-gray-500">Pay-as-you-go — all usage charged from wallet.</p>
            )}
          </div>
        </div>
      )}

      {/* Switch plan */}
      {available_plans.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Available Plans</h3>
            <p className="text-xs text-gray-600">Paid plans require payment — pricing is prorated.</p>
          </div>
          {switchMsg && (
            <div className={clsx(
              'text-xs px-4 py-2.5 rounded-lg border',
              switchMsg.includes('success')
                ? 'bg-emerald-950/30 border-emerald-900 text-emerald-400'
                : 'bg-red-950/30 border-red-900 text-red-400',
            )}>
              {switchMsg}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {available_plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={plan.id === currentPlanId}
                currentPlanPrice={currentPlanPrice}
                onSelect={handleSelectPlan}
                switching={switching}
              />
            ))}
          </div>
        </div>
      )}

      {/* Wallet transaction history */}
      <CreditLog />

      {/* Revenue breakdown (admin only) */}
      {user?.role === 'admin' && <RevenuePanel />}
    </div>
  )
}
