import { useState, useEffect } from 'react'
import client from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import {
  DollarSign, Wallet, Zap, Cpu, BarChart2, CheckCircle2,
  Loader2, AlertCircle, Monitor, CloudLightning, RefreshCw,
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

function PlanCard({
  plan, isCurrent, onSelect, switching,
}: {
  plan: PlanInfo
  isCurrent: boolean
  onSelect: (id: string) => void
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
          onClick={() => onSelect(plan.id)}
          disabled={!!switching}
          className="mt-auto w-full py-2 text-sm font-medium rounded-lg border border-brand-700 text-brand-400 hover:bg-brand-900/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 size={12} className="animate-spin" />}
          {isFree ? 'Switch to free' : 'Switch to this plan'}
        </button>
      )}
    </div>
  )
}

export default function UserBillingPage() {
  const { user } = useAuth()
  const [data, setData] = useState<MyPlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchMsg, setSwitchMsg] = useState('')

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

  const handleSwitchPlan = async (planId: string) => {
    setSwitching(planId)
    setSwitchMsg('')
    try {
      await client.post('/billing/switch-plan', { plan_id: planId })
      setSwitchMsg('Plan updated successfully.')
      await load()
    } catch (e: unknown) {
      setSwitchMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to switch plan. Contact support.')
    } finally {
      setSwitching(null)
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

  return (
    <div className="max-w-4xl space-y-8">
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
            <p className="text-xs text-gray-600">You can change your plan at any time.</p>
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
                onSelect={handleSwitchPlan}
                switching={switching}
              />
            ))}
          </div>
          <p className="text-xs text-gray-700">
            Plan changes take effect immediately. Wallet billing applies for usage beyond plan limits.
          </p>
        </div>
      )}
    </div>
  )
}
