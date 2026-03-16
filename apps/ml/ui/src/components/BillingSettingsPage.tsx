import React, { useState, useEffect } from 'react'
import {
  DollarSign, Cpu, Zap, Users, Plus, Pencil, Trash2,
  CheckCircle2, Loader2, Search, Star, ToggleLeft, ToggleRight,
  ChevronDown, Sparkles, Monitor,
} from 'lucide-react'
import clsx from 'clsx'
import { adminApi } from '../api/admin'
import type { MLPricingConfig, MLPlan, MLUserPlan, PlanPeriod } from '../types/plan'
import { PERIOD_LABELS } from '../types/plan'

type Tab = 'pricing' | 'plans' | 'user'

const PERIOD_OPTIONS: { value: PlanPeriod; label: string }[] = [
  { value: 'day',   label: 'Per Day' },
  { value: 'week',  label: 'Per Week' },
  { value: 'month', label: 'Per Month' },
  { value: 'none',  label: 'Lifetime (never resets)' },
]

// ── Reusable primitives ───────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={clsx(
        'flex items-center gap-1.5 text-xs font-medium transition-colors',
        value ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300',
      )}
    >
      {value
        ? <ToggleRight size={20} className="text-brand-400" />
        : <ToggleLeft size={20} />}
      {value ? 'Enabled' : 'Disabled'}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm text-gray-200">{label}</div>
        {hint && <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  step = 0.01,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
  step?: number
  disabled?: boolean
}) {
  return (
    <div className={clsx('flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5', disabled && 'opacity-40')}>
      {prefix && <span className="text-xs text-gray-500">{prefix}</span>}
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-24 bg-transparent text-sm text-white text-right outline-none disabled:cursor-not-allowed"
      />
      {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
    </div>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="appearance-none bg-gray-800 border border-gray-700 text-sm text-white rounded-lg pl-3 pr-7 py-1.5 outline-none focus:border-brand-600 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  )
}

function SaveBar({
  saving,
  saved,
  onSave,
}: {
  saving: boolean
  saved: boolean
  onSave: () => void
}) {
  return (
    <button
      onClick={onSave}
      disabled={saving}
      className={clsx(
        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
        saved
          ? 'bg-green-900/50 border border-green-700 text-green-300'
          : 'bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50',
      )}
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <DollarSign size={14} />}
      {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
    </button>
  )
}

// ── Pricing tab ───────────────────────────────────────────────────────────────

function PricingTab() {
  const [cfg, setCfg] = useState<MLPricingConfig | null>(null)
  const [form, setForm] = useState<Partial<MLPricingConfig>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [computeView, setComputeView] = useState<'cpu' | 'gpu'>('gpu')

  useEffect(() => {
    adminApi.getPricing()
      .then(d => { setCfg(d); setForm(d) })
      .finally(() => setLoading(false))
  }, [])

  const set = <K extends keyof MLPricingConfig>(k: K, v: MLPricingConfig[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      const updated = await adminApi.updatePricing(form)
      setCfg(updated)
      setForm(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !cfg) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 size={20} className="animate-spin text-gray-600" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Standard Training — CPU / GPU tabs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-sky-900/40 border border-sky-700/40 flex items-center justify-center">
            <Cpu size={15} className="text-sky-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">Standard Training</div>
            <div className="text-xs text-gray-500">Server compute rates — CPU-only and GPU. Users see the CPU rate when no GPU is detected; GPU rate when one is available.</div>
          </div>
          {/* CPU / GPU toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs font-medium">
            <button
              onClick={() => setComputeView('cpu')}
              className={clsx('flex items-center gap-1 px-3 py-1.5 transition-colors',
                computeView === 'cpu' ? 'bg-sky-800/60 text-sky-200' : 'text-gray-500 hover:text-gray-300')}
            >
              <Monitor size={11} /> CPU
            </button>
            <button
              onClick={() => setComputeView('gpu')}
              className={clsx('flex items-center gap-1 px-3 py-1.5 transition-colors border-l border-gray-700',
                computeView === 'gpu' ? 'bg-violet-800/60 text-violet-200' : 'text-gray-500 hover:text-gray-300')}
            >
              <Zap size={11} /> GPU
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {computeView === 'cpu' ? (
            <>
              <div className="flex items-center gap-2 text-xs text-sky-400 bg-sky-950/40 border border-sky-800/40 rounded-lg px-3 py-2">
                <Monitor size={12} />
                Standard CPU — charged when the server has no CUDA-capable GPU.
              </div>
              <Field
                label="Always free (global override)"
                hint="All Standard CPU training is free for every user regardless of plan."
              >
                <Toggle value={form.local_cpu_free ?? false} onChange={v => set('local_cpu_free', v)} />
              </Field>
              <Field label="Price per hour" hint="Rate for CPU-only wall-clock training time.">
                <NumberInput
                  value={form.local_cpu_price_per_hour ?? 0.05}
                  onChange={v => set('local_cpu_price_per_hour', v)}
                  prefix="$" suffix="/ hr" step={0.01}
                  disabled={form.local_cpu_free}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-violet-400 bg-violet-950/40 border border-violet-800/40 rounded-lg px-3 py-2">
                <Zap size={12} />
                Standard GPU — charged when the server has a CUDA-capable GPU (~$0.20/hr typical).
              </div>
              <Field
                label="Always free (global override)"
                hint="All Standard GPU training is free for every user. Per-user exemptions can be set in User Plan tab."
              >
                <Toggle value={form.local_gpu_free ?? false} onChange={v => set('local_gpu_free', v)} />
              </Field>
              <Field label="Price per hour" hint="Rate applied to actual wall-clock GPU time (not estimated).">
                <NumberInput
                  value={form.local_gpu_price_per_hour ?? 0.20}
                  onChange={v => set('local_gpu_price_per_hour', v)}
                  prefix="$" suffix="/ hr" step={0.01}
                  disabled={form.local_gpu_free}
                />
              </Field>
            </>
          )}
        </div>
      </div>

      {/* Inference */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2.5 pb-3 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-violet-900/40 border border-violet-700/40 flex items-center justify-center">
            <Zap size={15} className="text-violet-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Inference</div>
            <div className="text-xs text-gray-500">Charged per prediction call when plan free calls are exhausted</div>
          </div>
        </div>

        <Field
          label="Always free (global override)"
          hint="Inference is never charged for any user. Off by default — charges apply when plan free calls are exhausted."
        >
          <Toggle
            value={form.inference_free ?? false}
            onChange={v => set('inference_free', v)}
          />
        </Field>

        <Field
          label="Price per call"
          hint="Deducted directly from the user's wallet balance."
        >
          <NumberInput
            value={form.inference_price_per_call ?? 0.001}
            onChange={v => set('inference_price_per_call', v)}
            prefix="$"
            suffix="/ call"
            step={0.0001}
            disabled={form.inference_free}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveBar saving={saving} saved={saved} onSave={save} />
      </div>
    </div>
  )
}

// ── Plans tab ─────────────────────────────────────────────────────────────────

const BLANK_PLAN: Omit<MLPlan, 'id' | 'created_at' | 'updated_at'> = {
  name: '',
  description: '',
  price_usd_per_month: 0,
  included_period: 'month',
  included_cpu_hours: 0,
  included_local_gpu_hours: 0,
  included_cloud_gpu_credit_usd: 0,
  free_inference_calls: 0,
  free_inference_period: 'month',
  new_customer_credit_usd: 0,
  is_active: true,
  is_default: false,
}

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Partial<MLPlan> | null   // null = create
  onClose: () => void
  onSaved: (p: MLPlan) => void
}) {
  const isNew = !plan?.id
  const [form, setForm] = useState<Omit<MLPlan, 'id' | 'created_at' | 'updated_at'>>(
    plan ? {
      name: plan.name ?? '',
      description: plan.description ?? '',
      price_usd_per_month: plan.price_usd_per_month ?? 0,
      included_period: plan.included_period ?? 'month',
      included_cpu_hours: plan.included_cpu_hours ?? 0,
      included_local_gpu_hours: plan.included_local_gpu_hours ?? 0,
      included_cloud_gpu_credit_usd: plan.included_cloud_gpu_credit_usd ?? 0,
      free_inference_calls: plan.free_inference_calls ?? 0,
      free_inference_period: plan.free_inference_period ?? 'month',
      new_customer_credit_usd: plan.new_customer_credit_usd ?? 0,
      is_active: plan.is_active ?? true,
      is_default: plan.is_default ?? false,
    } : { ...BLANK_PLAN }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const result = isNew
        ? await adminApi.createPlan(form)
        : await adminApi.updatePlan(plan!.id!, form)
      onSaved(result)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-base font-bold text-white">{isNew ? 'Create Plan' : `Edit — ${plan?.name}`}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Name + description */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Plan name *</label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Starter, Pro, Enterprise"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Short description shown to users"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Monthly price (USD) — informational</label>
              <NumberInput value={form.price_usd_per_month} onChange={v => set('price_usd_per_month', v)} prefix="$" suffix="/ mo" step={1} />
            </div>
          </div>

          <div className="border-t border-gray-800" />

          {/* Included compute — period selector */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Included Compute</div>
            <div className="text-[11px] text-gray-500 mb-3">All compute is charged at the configured rates — plan covers those costs as part of the monthly fee.</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reset period</label>
                <Select<PlanPeriod> value={form.included_period as PlanPeriod} onChange={v => set('included_period', v)} options={PERIOD_OPTIONS} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Monitor size={12} className="text-sky-400 flex-shrink-0" />
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">CPU hours / period</label>
                  <NumberInput value={form.included_cpu_hours} onChange={v => set('included_cpu_hours', v)} suffix="hrs" step={1} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Zap size={12} className="text-violet-400 flex-shrink-0" />
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">Standard GPU hours / period</label>
                  <NumberInput value={form.included_local_gpu_hours} onChange={v => set('included_local_gpu_hours', v)} suffix="hrs" step={1} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <DollarSign size={12} className="text-amber-400 flex-shrink-0" />
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">Accelerated GPU credit / period (USD)</label>
                  <NumberInput value={form.included_cloud_gpu_credit_usd} onChange={v => set('included_cloud_gpu_credit_usd', v)} prefix="$" step={1} />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800" />

          {/* Free inference */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Free Inference Calls</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Calls included</label>
                <NumberInput value={form.free_inference_calls} onChange={v => set('free_inference_calls', Math.round(v))} suffix="calls" step={100} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reset period</label>
                <Select<PlanPeriod> value={form.free_inference_period} onChange={v => set('free_inference_period', v)} options={PERIOD_OPTIONS} />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800" />

          {/* New customer credit */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">New Customer Credit</div>
            <Field label="One-time credit (USD)" hint="Credited to wallet on first plan assignment. $0 = no credit.">
              <NumberInput value={form.new_customer_credit_usd} onChange={v => set('new_customer_credit_usd', v)} prefix="$" step={1} />
            </Field>
          </div>

          <div className="border-t border-gray-800" />

          {/* Status flags */}
          <div className="space-y-3">
            <Field label="Set as default plan" hint="Auto-assigned to new users who have no plan.">
              <Toggle value={form.is_default} onChange={v => set('is_default', v)} />
            </Field>
            <Field label="Active" hint="Inactive plans cannot be assigned to new users.">
              <Toggle value={form.is_active} onChange={v => set('is_active', v)} />
            </Field>
          </div>
        </div>

        {error && (
          <p className="px-6 py-2 text-xs text-red-400 bg-red-900/20 border-t border-red-900/30">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {isNew ? 'Create Plan' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PlansTab() {
  const [plans, setPlans] = useState<MLPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Partial<MLPlan> | null>(null)  // null means closed, {} means new
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MLPlan | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)

  const load = async (inactive = showInactive) => {
    setLoading(true)
    try { setPlans(await adminApi.getPlans(inactive)) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSaved = (plan: MLPlan) => {
    setPlans(prev => {
      const idx = prev.findIndex(p => p.id === plan.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = plan
        // If this plan is now default, clear others
        if (plan.is_default) next.forEach((p, i) => { if (i !== idx) next[i] = { ...p, is_default: false } })
        return next
      }
      return [plan, ...prev]
    })
    setEditing(null)
  }

  const handleDelete = async (plan: MLPlan) => {
    setDeleting(plan.id)
    try {
      await adminApi.deletePlan(plan.id)
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, is_active: false } : p))
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  const visiblePlans = showInactive ? plans : plans.filter(p => p.is_active)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Subscription Plans</h3>
          <button
            onClick={() => { setShowInactive(!showInactive); load(!showInactive) }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setSeeding(true)
              setSeedResult(null)
              try {
                const res = await adminApi.seedPlans()
                const msg = res.created.length > 0
                  ? `Created: ${res.created.join(', ')}`
                  : `All plans already exist (${res.skipped.join(', ')})`
                setSeedResult(msg)
                if (res.created.length > 0) await load()
                setTimeout(() => setSeedResult(null), 4000)
              } finally {
                setSeeding(false)
              }
            }}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-800/40 hover:bg-amber-700/40 border border-amber-700/40 text-amber-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {seeding ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Seed suggested plans
          </button>
          <button
            onClick={() => setEditing({} as MLPlan)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={13} /> New Plan
          </button>
        </div>
      </div>

      {seedResult && (
        <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
          {seedResult}
        </div>
      )}

      {/* Plans table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={18} className="animate-spin text-gray-600" />
        </div>
      ) : visiblePlans.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <div className="text-gray-500 text-sm">No plans yet</div>
          <div className="text-gray-600 text-xs mt-1">Create your first plan to start billing users</div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Price</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><Monitor size={11} className="text-sky-400" /> CPU hrs</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><Zap size={11} className="text-violet-400" /> Std GPU hrs</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><DollarSign size={11} className="text-amber-400" /> Accel. cr.</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><Zap size={11} className="text-blue-400" /> Inference</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><DollarSign size={11} className="text-green-400" /> Welcome $</span>
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visiblePlans.map((plan, idx) => (
                <tr
                  key={plan.id}
                  className={clsx(
                    'border-b border-gray-800/60 last:border-b-0 transition-colors',
                    idx % 2 === 0 ? 'bg-gray-900/40' : 'bg-gray-900/20',
                    !plan.is_active && 'opacity-50',
                  )}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-white">{plan.name}</span>
                      {plan.is_default && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded px-1.5 py-0.5">
                          <Star size={9} /> default
                        </span>
                      )}
                      {!plan.is_active && (
                        <span className="text-[10px] text-gray-600 bg-gray-800 rounded px-1.5 py-0.5">inactive</span>
                      )}
                    </div>
                    {plan.description && (
                      <div className="text-[11px] text-gray-600 mt-0.5 max-w-xs truncate">{plan.description}</div>
                    )}
                  </td>
                  {/* Price */}
                  <td className="px-4 py-3 font-bold">
                    {plan.price_usd_per_month > 0
                      ? <span className="text-white">${plan.price_usd_per_month}<span className="text-gray-600 text-xs font-normal">/mo</span></span>
                      : <span className="text-green-400">Free</span>}
                  </td>
                  {/* CPU hrs */}
                  <td className="px-4 py-3">
                    {plan.included_cpu_hours > 0
                      ? <span className="text-sky-300 font-medium">{plan.included_cpu_hours}h <span className="text-gray-600 text-[10px]">{PERIOD_LABELS[plan.included_period]}</span></span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  {/* Standard GPU hrs */}
                  <td className="px-4 py-3">
                    {plan.included_local_gpu_hours > 0
                      ? <span className="text-violet-300 font-medium">{plan.included_local_gpu_hours}h <span className="text-gray-600 text-[10px]">{PERIOD_LABELS[plan.included_period]}</span></span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  {/* Cloud GPU credit */}
                  <td className="px-4 py-3">
                    {plan.included_cloud_gpu_credit_usd > 0
                      ? <span className="text-amber-300 font-medium">${plan.included_cloud_gpu_credit_usd} <span className="text-gray-600 text-[10px]">{PERIOD_LABELS[plan.included_period]}</span></span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  {/* Inference */}
                  <td className="px-4 py-3">
                    {plan.free_inference_calls > 0
                      ? <span className="text-blue-300 font-medium">{plan.free_inference_calls.toLocaleString()} <span className="text-gray-600 text-[10px]">{PERIOD_LABELS[plan.free_inference_period]}</span></span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  {/* Welcome credit */}
                  <td className="px-4 py-3">
                    {plan.new_customer_credit_usd > 0
                      ? <span className="text-green-400 font-medium">${plan.new_customer_credit_usd}</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditing(plan)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                      {plan.is_active && (
                        <button
                          onClick={() => setConfirmDelete(plan)}
                          disabled={deleting === plan.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {deleting === plan.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / Create modal */}
      {editing !== null && (
        <PlanModal
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Confirm deactivate */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2">Deactivate plan?</h3>
            <p className="text-sm text-gray-400 mb-5">
              <span className="text-white font-medium">{confirmDelete.name}</span> will be deactivated.
              Existing user assignments are unaffected.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={!!deleting}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── User plan tab ─────────────────────────────────────────────────────────────

function UsageMeter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-brand-500'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={clsx('font-medium', pct >= 90 ? 'text-red-400' : 'text-gray-300')}>
          {used.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function UserPlanTab() {
  const [email, setEmail] = useState('')
  const [orgId, setOrgId] = useState('')
  const [info, setInfo] = useState<{ user_email: string; plan: MLPlan | null; usage?: MLUserPlan; pricing?: MLPricingConfig } | null>(null)
  const [plans, setPlans] = useState<MLPlan[]>([])
  const [searching, setSearching] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [assignError, setAssignError] = useState('')
  const [assignDone, setAssignDone] = useState(false)
  const [exempting, setExempting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.getPlans().then(setPlans).catch(() => {})
  }, [])

  const search = async () => {
    if (!email.trim()) return
    setSearching(true)
    setError('')
    setInfo(null)
    try {
      const result = await adminApi.getUserPlan(email.trim(), orgId.trim())
      setInfo(result)
      setSelectedPlanId(result.plan?.id ?? '')
    } catch {
      setError('User not found or no plan data available')
    } finally {
      setSearching(false)
    }
  }

  const assign = async () => {
    if (!selectedPlanId || !info) return
    setAssigning(true)
    setAssignError('')
    try {
      await adminApi.assignPlan(selectedPlanId, info.user_email, orgId.trim())
      setAssignDone(true)
      setTimeout(() => setAssignDone(false), 2500)
      // Refresh
      const result = await adminApi.getUserPlan(info.user_email, orgId.trim())
      setInfo(result)
    } catch (e: any) {
      setAssignError(e?.message ?? 'Failed to assign plan')
    } finally {
      setAssigning(false)
    }
  }

  const usage = info?.usage
  const plan = info?.plan

  const fmt = (dt: string | null) =>
    dt ? new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <div className="max-w-2xl space-y-5">
      {/* Search */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Look up user</div>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="user@example.com"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-600"
          />
          <input
            value={orgId}
            onChange={e => setOrgId(e.target.value)}
            placeholder="org_id (optional)"
            className="w-36 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-600"
          />
          <button
            onClick={search}
            disabled={!email.trim() || searching}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Search
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Result */}
      {info && (
        <>
          {/* Current plan */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Current Plan</div>
              {usage?.assigned_at && (
                <span className="text-[11px] text-gray-600">Assigned {fmt(usage.assigned_at)}</span>
              )}
            </div>

            {plan ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-900/30 border border-brand-700/30 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={16} className="text-brand-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold">{plan.name}</span>
                    {plan.is_default && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded px-1.5 py-0.5">
                        <Star size={9} /> default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {plan.included_cpu_hours}h CPU · {plan.included_local_gpu_hours}h GPU · {plan.free_inference_calls.toLocaleString()} calls {PERIOD_LABELS[plan.included_period]}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No plan assigned — using global pricing defaults.</div>
            )}

            {usage?.new_customer_credit_given && usage.new_customer_credit_amount > 0 && (
              <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/20 border border-green-800/30 rounded-lg px-3 py-2">
                <CheckCircle2 size={13} />
                ${usage.new_customer_credit_amount} new customer credit was given
              </div>
            )}
          </div>

          {/* Usage */}
          {usage && plan && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Usage This Period</div>
              <div className="space-y-4">
                <div>
                  <UsageMeter
                    label="Training"
                    used={parseFloat(usage.free_training_used_hours.toFixed(2))}
                    total={plan.included_cpu_hours}
                  />
                  {usage.free_training_period_reset_at && (
                    <div className="text-[11px] text-gray-600 mt-1">
                      Resets {fmt(usage.free_training_period_reset_at)}
                    </div>
                  )}
                </div>
                <div>
                  <UsageMeter
                    label="Inference calls"
                    used={usage.free_inference_used}
                    total={plan.free_inference_calls}
                  />
                  {usage.free_inference_period_reset_at && (
                    <div className="text-[11px] text-gray-600 mt-1">
                      Resets {fmt(usage.free_inference_period_reset_at)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* GPU exemption */}
          {usage && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <Field
                label="Exempt from Standard GPU charges"
                hint="When enabled, this user's Standard GPU training jobs are always free regardless of global pricing."
              >
                {exempting
                  ? <Loader2 size={16} className="animate-spin text-gray-500" />
                  : (
                    <Toggle
                      value={usage.local_gpu_exempt}
                      onChange={async (v) => {
                        setExempting(true)
                        try {
                          const updated = await adminApi.setUserExempt(info!.user_email, orgId.trim(), v)
                          setInfo(prev => prev ? { ...prev, usage: updated } : prev)
                        } finally {
                          setExempting(false)
                        }
                      }}
                    />
                  )
                }
              </Field>
            </div>
          )}

          {/* Assign plan */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assign Plan</div>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <select
                  value={selectedPlanId}
                  onChange={e => setSelectedPlanId(e.target.value)}
                  className="w-full appearance-none bg-gray-800 border border-gray-700 text-sm text-white rounded-lg pl-3 pr-7 py-2 outline-none focus:border-brand-600"
                >
                  <option value="">— select a plan —</option>
                  {plans.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
              <button
                onClick={assign}
                disabled={!selectedPlanId || assigning}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  assignDone
                    ? 'bg-green-900/50 border border-green-700 text-green-300'
                    : 'bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white',
                )}
              >
                {assigning ? <Loader2 size={13} className="animate-spin" /> : assignDone ? <CheckCircle2 size={13} /> : <Users size={13} />}
                {assignDone ? 'Assigned!' : 'Assign'}
              </button>
            </div>
            {assignError && <p className="text-xs text-red-400">{assignError}</p>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function Layers({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'pricing', label: 'Pricing',   icon: <DollarSign size={13} /> },
  { id: 'plans',   label: 'Plans',     icon: <Layers size={13} /> },
  { id: 'user',    label: 'User Plan', icon: <Users size={13} /> },
]

export default function BillingSettingsPage() {
  const [tab, setTab] = useState<Tab>('pricing')

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-800 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'pricing' && <PricingTab />}
      {tab === 'plans'   && <PlansTab />}
      {tab === 'user'    && <UserPlanTab />}
    </div>
  )
}
