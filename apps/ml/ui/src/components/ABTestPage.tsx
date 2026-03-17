import { useState, useEffect } from 'react'
import { abTestsApi, type ABTest, type CreateABTestPayload } from '../api/abTests'
import { trainersApi } from '../api/trainers'
import { feedbackApi } from '../api/feedback'
import type { ModelDeployment, TrainerDerivedMetricSpec } from '../types/trainer'
import type { DerivedMetricsResult } from '../types/feedback'
import {
  FlaskConical, Plus, Pause, Play, Trophy, Trash2, Loader2,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart2, Info,
} from 'lucide-react'
import clsx from 'clsx'

// ── Built-in metric definitions ────────────────────────────────────────────────

const BUILTIN_METRICS: Array<{ key: string; label: string; higher_is_better: boolean; format: (v: number) => string }> = [
  { key: 'requests',   label: 'Requests',   higher_is_better: true,  format: v => v.toLocaleString() },
  { key: 'error_rate', label: 'Error Rate',  higher_is_better: false, format: v => `${(v * 100).toFixed(2)}%` },
  { key: 'latency',    label: 'Latency',     higher_is_better: false, format: v => `${v.toFixed(0)} ms` },
  { key: 'accuracy',   label: 'Accuracy',    higher_is_better: true,  format: v => `${(v * 100).toFixed(1)}%` },
]

function builtinValue(m: ABTest['metrics_a'], key: string): number | null {
  if (key === 'requests')   return m.requests
  if (key === 'error_rate') return m.error_rate
  if (key === 'latency')    return m.avg_latency_ms
  if (key === 'accuracy')   return m.accuracy
  return null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function deployLabel(d: ModelDeployment) {
  return `v${d.mlflow_model_version}${d.is_default ? ' ★' : ''}`
}

function fmtDerived(v: number | null, spec: TrainerDerivedMetricSpec): string {
  if (v == null) return '—'
  return spec.unit === '%'
    ? `${(v * 100).toFixed(1)}%`
    : `${v.toFixed(2)}${spec.unit ? ' ' + spec.unit : ''}`
}

// ── Variant radio picker ───────────────────────────────────────────────────────

function VariantPicker({
  badge, label, badgeCls, deploys, selected, disabledId, onChange,
}: {
  badge: string; label: string; badgeCls: string
  deploys: ModelDeployment[]; selected: string; disabledId: string; onChange: (id: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-widest', badgeCls)}>{badge}</span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
      </div>
      {deploys.map(d => {
        const isDisabled = d.id === disabledId
        const isSelected = d.id === selected
        return (
          <button key={d.id} disabled={isDisabled} onClick={() => !isDisabled && onChange(d.id)}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-colors text-xs',
              isDisabled && 'opacity-30 cursor-not-allowed bg-gray-900 border-gray-800',
              !isDisabled && isSelected && badge === 'A' && 'bg-brand-900/30 border-brand-700',
              !isDisabled && isSelected && badge === 'B' && 'bg-emerald-900/20 border-emerald-700',
              !isDisabled && !isSelected && 'bg-gray-900 border-gray-800 hover:border-gray-700',
            )}>
            <span className={clsx('w-3 h-3 rounded-full border-2 flex-shrink-0',
              isSelected
                ? badge === 'A' ? 'bg-brand-400 border-brand-400' : 'bg-emerald-400 border-emerald-400'
                : 'border-gray-600 bg-transparent')} />
            <div className="flex-1 min-w-0">
              <span className={clsx('font-mono', isSelected
                ? badge === 'A' ? 'text-brand-400' : 'text-emerald-400'
                : 'text-gray-500')}>
                {deployLabel(d)}
              </span>
              <span className="text-gray-600 ml-2">
                {d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}
              </span>
              {isDisabled && <span className="text-gray-600 ml-1">(selected as {badge === 'A' ? 'B' : 'A'})</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Metric selector ────────────────────────────────────────────────────────────

const REQUIRED_BUILTINS = ['requests', 'error_rate', 'latency']

function MetricSelector({
  derivedSpecs,
  selected,
  onChange,
}: {
  derivedSpecs: TrainerDerivedMetricSpec[]
  selected: string[]
  onChange: (keys: string[]) => void
}) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key])
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Metrics to track</p>

      <div className="space-y-1">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Always included</p>
        {REQUIRED_BUILTINS.map(key => {
          const spec = BUILTIN_METRICS.find(m => m.key === key)!
          return (
            <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 opacity-60">
              <span className="w-3 h-3 rounded border-2 bg-brand-500 border-brand-500 flex-shrink-0" />
              <span className="text-xs text-gray-400">{spec.label}</span>
              <span className="text-[10px] text-gray-600 ml-auto">required</span>
            </div>
          )
        })}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Optional built-in</p>
        {['accuracy'].map(key => {
          const spec = BUILTIN_METRICS.find(m => m.key === key)!
          const on = selected.includes(key)
          return (
            <button key={key} onClick={() => toggle(key)}
              className={clsx('w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border text-left text-xs transition-colors',
                on ? 'bg-brand-900/20 border-brand-800 text-gray-200' : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700')}>
              <span className={clsx('w-3 h-3 rounded border-2 flex-shrink-0', on ? 'bg-brand-500 border-brand-500' : 'border-gray-600 bg-transparent')} />
              <span>{spec.label}</span>
              <span className="text-[10px] text-gray-600 ml-auto">{spec.higher_is_better ? '↑ higher better' : '↓ lower better'}</span>
            </button>
          )
        })}
      </div>

      {derivedSpecs.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">Trainer-declared metrics</p>
          {derivedSpecs.map(spec => {
            const on = selected.includes(spec.key)
            return (
              <button key={spec.key} onClick={() => toggle(spec.key)}
                className={clsx('w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border text-left text-xs transition-colors',
                  on ? 'bg-emerald-900/20 border-emerald-800 text-gray-200' : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700')}>
                <span className={clsx('w-3 h-3 rounded border-2 flex-shrink-0', on ? 'bg-emerald-500 border-emerald-500' : 'border-gray-600 bg-transparent')} />
                <div className="flex-1 min-w-0">
                  <span>{spec.label}</span>
                  {spec.description && <span className="text-[10px] text-gray-600 ml-2">{spec.description}</span>}
                </div>
                <span className="text-[10px] text-gray-600 ml-auto flex-shrink-0">
                  {spec.higher_is_better ? '↑' : '↓'} {spec.unit || ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {derivedSpecs.length === 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-600">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          This trainer has no <code className="bg-gray-800 px-1 rounded text-gray-400">derived_metrics</code> declared.
          Add them in the trainer file to unlock EMR, digit accuracy, edit distance, and billing impact tracking.
        </div>
      )}
    </div>
  )
}

// ── Create form ────────────────────────────────────────────────────────────────

function CreateForm({
  allDeployments,
  onCreated,
  onCancel,
}: {
  allDeployments: ModelDeployment[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [trainerName, setTrainerName] = useState('')
  const [variantA, setVariantA] = useState('')
  const [variantB, setVariantB] = useState('')
  const [trafficPct, setTrafficPct] = useState(20)
  const [metricsToUse, setMetricsToUse] = useState<string[]>(['accuracy'])
  const [derivedSpecs, setDerivedSpecs] = useState<TrainerDerivedMetricSpec[]>([])
  const [loadingSpecs, setLoadingSpecs] = useState(false)
  const [saving, setSaving] = useState(false)

  const trainerNames = [...new Set(allDeployments.map(d => d.trainer_name))].sort()
  const trainerDeploys = allDeployments
    .filter(d => d.trainer_name === trainerName && d.status === 'active')
    .sort((a, b) => parseInt(b.mlflow_model_version || '0', 10) - parseInt(a.mlflow_model_version || '0', 10))

  // When trainer changes: clear variants, fetch derived_metrics spec
  const handleTrainerChange = async (name: string) => {
    setTrainerName(name)
    setVariantA('')
    setVariantB('')
    setDerivedSpecs([])
    if (!name) return
    setLoadingSpecs(true)
    try {
      const reg = await trainersApi.get(name)
      setDerivedSpecs(reg.derived_metrics ?? [])
    } catch {
      // trainer registration may not exist yet for pre-trained models
    } finally {
      setLoadingSpecs(false)
    }
  }

  // Default variant A to the default deployment when trainer is picked
  useEffect(() => {
    if (trainerDeploys.length > 0 && !variantA) {
      const def = trainerDeploys.find(d => d.is_default) ?? trainerDeploys[0]
      setVariantA(def.id)
      const other = trainerDeploys.find(d => d.id !== def.id)
      if (other) setVariantB(other.id)
    }
  }, [trainerName]) // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = name.trim() && trainerName && variantA && variantB && variantA !== variantB

  const handleCreate = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      const payload: CreateABTestPayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        trainer_name: trainerName,
        variant_a: variantA,
        variant_b: variantB,
        traffic_pct_b: trafficPct,
        metrics_to_use: [...REQUIRED_BUILTINS, ...metricsToUse.filter(k => !REQUIRED_BUILTINS.includes(k))],
      }
      await abTestsApi.create(payload)
      onCreated()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to create test')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
      <h3 className="text-sm font-semibold text-white">New A/B test</h3>

      {/* Name + Description */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-gray-500">Test name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="v2-meter-challenger"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-500">Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500" />
        </div>
      </div>

      {/* Trainer picker */}
      <div className="space-y-1">
        <label className="text-xs text-gray-500">Model <span className="text-red-500">*</span></label>
        <p className="text-[10px] text-gray-600">Both variants must be versions of the same model.</p>
        <select value={trainerName} onChange={e => handleTrainerChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500">
          <option value="">Select a model…</option>
          {trainerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Variant A / B pickers */}
      {trainerName && (
        trainerDeploys.length < 2 ? (
          <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-400">
            <Info size={13} className="flex-shrink-0" />
            <span>
              <strong>{trainerName}</strong> has only {trainerDeploys.length} active deployment.
              Train or deploy a second version to run an A/B test.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <VariantPicker badge="A" label="Baseline" badgeCls="bg-brand-900 text-brand-300"
              deploys={trainerDeploys} selected={variantA} disabledId={variantB}
              onChange={setVariantA} />
            <VariantPicker badge="B" label="Challenger" badgeCls="bg-emerald-900/60 text-emerald-300"
              deploys={trainerDeploys} selected={variantB} disabledId={variantA}
              onChange={setVariantB} />
          </div>
        )
      )}

      {/* Metric selector */}
      {trainerName && trainerDeploys.length >= 2 && (
        loadingSpecs
          ? <div className="flex items-center gap-2 text-xs text-gray-600"><Loader2 size={12} className="animate-spin" /> Loading metrics…</div>
          : <MetricSelector derivedSpecs={derivedSpecs} selected={metricsToUse} onChange={setMetricsToUse} />
      )}

      {/* Traffic split */}
      {trainerName && trainerDeploys.length >= 2 && (
        <div className="space-y-1">
          <label className="text-xs text-gray-500">
            Traffic split — <span className="text-brand-400">A: {100 - trafficPct}%</span>
            {' '}· <span className="text-emerald-400">B: {trafficPct}%</span>
          </label>
          <input type="range" min={1} max={99} value={trafficPct}
            onChange={e => setTrafficPct(+e.target.value)} className="w-full accent-brand-500" />
          <div className="flex justify-between text-[10px] text-gray-600">
            <span>A (baseline) gets more traffic</span>
            <span>Equal</span>
            <span>B (challenger) gets more traffic</span>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={handleCreate} disabled={saving || !canSubmit}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create test
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors">Cancel</button>
      </div>
    </div>
  )
}

// ── Test card ──────────────────────────────────────────────────────────────────

function TestCard({
  test,
  deployments,
  onToggle,
  onConclude,
  onDelete,
}: {
  test: ABTest
  deployments: ModelDeployment[]
  onToggle: () => void
  onConclude: (winner: 'a' | 'b') => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [derived, setDerived] = useState<DerivedMetricsResult | null>(null)
  const [loadingDerived, setLoadingDerived] = useState(false)

  const deployA = deployments.find(d => d.id === test.variant_a)
  const deployB = deployments.find(d => d.id === test.variant_b)

  const labelA = deployA ? `A · v${deployA.mlflow_model_version}` : `A · ${(test.variant_a ?? '').slice(0, 8)}`
  const labelB = deployB ? `B · v${deployB.mlflow_model_version}` : `B · ${(test.variant_b ?? '').slice(0, 8)}`

  // Derived metric keys in metrics_to_use (i.e. not built-in)
  const builtinKeys = BUILTIN_METRICS.map(m => m.key)
  const derivedKeys = (test.metrics_to_use ?? []).filter(k => !builtinKeys.includes(k))

  const handleExpand = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && derivedKeys.length > 0 && !derived) {
      setLoadingDerived(true)
      try {
        const dm = await feedbackApi.derivedMetrics(test.trainer_name, [test.variant_a, test.variant_b])
        setDerived(dm.specs.length > 0 ? dm : null)
      } catch { /* no feedback yet */ } finally {
        setLoadingDerived(false)
      }
    }
  }

  const metricsToShow = (test.metrics_to_use ?? []).filter(k => builtinKeys.includes(k))

  return (
    <div className={clsx('bg-gray-900 border rounded-xl overflow-hidden transition-colors',
      test.status === 'active' ? 'border-gray-800' : 'border-gray-800/50')}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button onClick={handleExpand} className="flex items-center gap-3 flex-1 text-left min-w-0">
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
            test.status === 'active' ? 'bg-emerald-400 animate-pulse'
            : test.status === 'paused' ? 'bg-yellow-400' : 'bg-gray-600')} />
          <span className="text-sm font-medium text-white truncate">{test.name}</span>
          {test.description && <span className="text-xs text-gray-500 truncate hidden lg:block">{test.description}</span>}
          <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0',
            test.status === 'active' ? 'text-emerald-400 border-emerald-800 bg-emerald-900/20'
            : test.status === 'paused' ? 'text-yellow-400 border-yellow-800 bg-yellow-900/20'
            : 'text-gray-500 border-gray-700')}>
            {test.status}
          </span>
          {/* Trainer + variant summary */}
          <span className="text-[10px] text-gray-600 flex-shrink-0 hidden md:block">
            {test.trainer_name} · {deployA ? `v${deployA.mlflow_model_version}` : '?'} vs {deployB ? `v${deployB.mlflow_model_version}` : '?'}
          </span>
          {expanded ? <ChevronDown size={13} className="text-gray-600 ml-auto flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-600 ml-auto flex-shrink-0" />}
        </button>

        <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
          {test.status !== 'concluded' && (
            <>
              <button onClick={onToggle} title={test.status === 'active' ? 'Pause' : 'Resume'}
                className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                {test.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button onClick={() => onConclude('a')} title="Declare A the winner"
                className="px-2 py-1 text-[10px] text-gray-400 hover:text-brand-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors">
                A wins
              </button>
              <button onClick={() => onConclude('b')} title="Declare B the winner"
                className="px-2 py-1 text-[10px] text-gray-400 hover:text-emerald-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors">
                B wins
              </button>
            </>
          )}
          <button onClick={onDelete} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Metrics table (always visible) */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-800/40">
              <th className="px-4 py-2 text-left text-gray-600 font-medium w-36">Variant</th>
              {metricsToShow.map(key => {
                const spec = BUILTIN_METRICS.find(m => m.key === key)
                return <th key={key} className="px-3 py-2 text-left text-gray-600 font-medium">{spec?.label ?? key}</th>
              })}
              <th className="px-3 py-2 text-left text-gray-600 font-medium">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {([
              { badge: 'A', label: labelA, m: test.metrics_a, pct: 100 - test.traffic_pct_b, winner: test.winner === 'a', variantId: test.variant_a },
              { badge: 'B', label: labelB, m: test.metrics_b, pct: test.traffic_pct_b,     winner: test.winner === 'b', variantId: test.variant_b },
            ] as const).map(({ badge, label, m, pct, winner }) => (
              <tr key={badge} className="border-t border-gray-800/60 hover:bg-gray-800/20">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded',
                      badge === 'A' ? 'bg-brand-900/60 text-brand-300' : 'bg-emerald-900/40 text-emerald-300')}>
                      {badge}
                    </span>
                    <span className="font-medium text-gray-300">{label}</span>
                    {winner && <Trophy size={10} className="text-yellow-400" />}
                  </div>
                </td>
                {metricsToShow.map(key => {
                  const spec = BUILTIN_METRICS.find(s => s.key === key)!
                  const val = builtinValue(m, key)
                  const other = badge === 'A' ? builtinValue(test.metrics_b, key) : builtinValue(test.metrics_a, key)
                  const wins = val != null && other != null && (spec.higher_is_better ? val > other : val < other)
                  return (
                    <td key={key} className={clsx('px-3 py-2.5 font-mono',
                      wins ? 'text-emerald-400 font-semibold' : 'text-gray-400')}>
                      {val != null ? spec.format(val) : '—'}
                      {wins && <span className="ml-1 text-[10px]">▲</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full', badge === 'A' ? 'bg-brand-500' : 'bg-emerald-500')}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-gray-600 text-[10px]">{pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Derived metrics — shown when expanded */}
      {expanded && derivedKeys.length > 0 && (
        <div className="border-t border-gray-800">
          {loadingDerived ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-600">
              <Loader2 size={12} className="animate-spin" /> Loading trainer metrics…
            </div>
          ) : !derived ? (
            <div className="flex items-start gap-2 px-4 py-3 text-xs text-gray-600">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              No feedback collected yet for these variants. Run inference and approve/correct results to compute trainer metrics.
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-800/30">
                <BarChart2 size={13} className="text-brand-400" />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                  Trainer Metrics
                </span>
                <span className="text-[10px] text-gray-600">from feedback · {test.trainer_name}</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/20">
                    <th className="px-4 py-2 text-left text-gray-600 font-medium">Metric</th>
                    <th className="px-4 py-2 text-right text-brand-400 font-mono">A · {deployA ? `v${deployA.mlflow_model_version}` : '?'}</th>
                    <th className="px-4 py-2 text-right text-emerald-400 font-mono">B · {deployB ? `v${deployB.mlflow_model_version}` : '?'}</th>
                    <th className="px-4 py-2 text-right text-gray-600">Δ vs A</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {derivedKeys.map(key => {
                    const spec = derived.specs.find(s => s.key === key)
                    if (!spec) return null
                    const valA = derived.per_deployment[test.variant_a]?.[key] ?? null
                    const valB = derived.per_deployment[test.variant_b]?.[key] ?? null
                    const bWins = valA != null && valB != null && (spec.higher_is_better ? valB > valA : valB < valA)
                    const bLoses = valA != null && valB != null && (spec.higher_is_better ? valB < valA : valB > valA)
                    const delta = valA != null && valB != null
                      ? (valB - valA >= 0 ? '+' : '') + fmtDerived(valB - valA, spec)
                      : null
                    return (
                      <tr key={key} className="hover:bg-gray-800/20">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {spec.higher_is_better
                              ? <TrendingUp size={11} className="text-gray-600" />
                              : <TrendingDown size={11} className="text-gray-600" />}
                            <span className="text-gray-300">{spec.label}</span>
                          </div>
                          {spec.description && <div className="text-[10px] text-gray-600 ml-4">{spec.description}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-500">{fmtDerived(valA, spec)}</td>
                        <td className={clsx('px-4 py-2.5 text-right font-mono font-semibold',
                          bWins ? 'text-emerald-400' : bLoses ? 'text-red-400' : 'text-gray-300')}>
                          {fmtDerived(valB, spec)}
                          {bWins && <span className="ml-1 text-[9px] text-emerald-600">▲</span>}
                          {bLoses && <span className="ml-1 text-[9px] text-red-600">▼</span>}
                        </td>
                        <td className={clsx('px-4 py-2.5 text-right font-mono text-[11px]',
                          bWins ? 'text-emerald-500' : bLoses ? 'text-red-500' : 'text-gray-600')}>
                          {delta ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 text-[10px] text-gray-700 border-t border-gray-800/60">
                Δ = B minus A · <span className="text-emerald-600">▲ green</span> = B wins · <span className="text-red-600">▼ red</span> = B loses
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ABTestPage() {
  const [tests, setTests] = useState<ABTest[]>([])
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [t, d] = await Promise.all([abTestsApi.list(), trainersApi.listDeployments()])
      setTests(t)
      setDeployments(d)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggleStatus = async (test: ABTest) => {
    await abTestsApi.update(test.id, { status: test.status === 'active' ? 'paused' : 'active' })
    await load()
  }

  const conclude = async (test: ABTest, winner: 'a' | 'b') => {
    await abTestsApi.update(test.id, { status: 'concluded', winner })
    await load()
  }

  const deleteTest = async (id: string) => {
    if (!confirm('Delete this A/B test?')) return
    await abTestsApi.delete(id)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">A/B Tests</h2>
          <span className="text-xs text-gray-600">{tests.length} total</span>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors">
          <Plus size={12} /> New test
        </button>
      </div>

      {showCreate && (
        <CreateForm
          allDeployments={deployments}
          onCreated={async () => { setShowCreate(false); await load() }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-gray-600" /></div>
      ) : tests.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <FlaskConical size={28} className="mx-auto text-gray-700" />
          <p className="text-gray-600 text-sm">No A/B tests yet</p>
          <p className="text-gray-700 text-xs">Create a test to compare two versions of the same model with real traffic.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map(test => (
            <TestCard
              key={test.id}
              test={test}
              deployments={deployments}
              onToggle={() => toggleStatus(test)}
              onConclude={(winner) => conclude(test, winner)}
              onDelete={() => deleteTest(test.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
