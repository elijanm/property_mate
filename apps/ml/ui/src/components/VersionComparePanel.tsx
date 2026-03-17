import { useState } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import type { VersionComparison } from '@/types/inference'
import type { DerivedMetricsResult } from '@/types/feedback'
import { inferenceApi } from '@/api/inference'
import { feedbackApi } from '@/api/feedback'
import {
  Play, Loader2, AlertCircle, CheckCircle2, XCircle,
  BarChart2, Info, ArrowRight, TrendingUp, TrendingDown,
} from 'lucide-react'
import clsx from 'clsx'

interface Props {
  versions: ModelDeployment[]
  currentDeployment: ModelDeployment
  lastInputs: unknown
}

function schemasCompatible(a: ModelDeployment, b: ModelDeployment): boolean {
  const ka = Object.keys(a.input_schema ?? {}).sort()
  const kb = Object.keys(b.input_schema ?? {}).sort()
  return ka.join(',') === kb.join(',')
}

function formatRaw(val: unknown): string {
  if (val == null) return '—'
  if (typeof val === 'number') {
    return val <= 1 && val >= 0 ? `${(val * 100).toFixed(1)}%` : val.toFixed(4)
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

function resultKeys(result: unknown): string[] {
  if (result == null || typeof result !== 'object') return []
  return Object.keys(result as object)
}

function VersionPicker({
  label,
  badge,
  badgeColor,
  versions,
  selected,
  disabledId,
  onChange,
}: {
  label: string
  badge: string
  badgeColor: string
  versions: ModelDeployment[]
  selected: string
  disabledId: string | null
  onChange: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-widest', badgeColor)}>
          {badge}
        </span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
      </div>
      <div className="space-y-1.5">
        {versions.map(v => {
          const isSelected = selected === v.id
          const isDisabled = v.id === disabledId
          return (
            <button
              key={v.id}
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(v.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors',
                isDisabled && 'opacity-30 cursor-not-allowed',
                !isDisabled && isSelected && badgeColor === 'bg-brand-900 text-brand-300 border-brand-700'
                  ? 'bg-brand-900/30 border-brand-700'
                  : !isDisabled && isSelected && 'bg-emerald-900/20 border-emerald-700',
                !isDisabled && !isSelected && 'bg-gray-900 border-gray-800 hover:border-gray-700',
              )}
            >
              {/* selection dot */}
              <span className={clsx(
                'w-3 h-3 rounded-full border-2 flex-shrink-0',
                isSelected
                  ? badge === 'A' ? 'bg-brand-400 border-brand-400' : 'bg-emerald-400 border-emerald-400'
                  : 'border-gray-600 bg-transparent',
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx(
                    'font-mono text-xs',
                    isSelected
                      ? badge === 'A' ? 'text-brand-400' : 'text-emerald-400'
                      : 'text-gray-500',
                  )}>
                    v{v.mlflow_model_version}
                  </span>
                  {v.is_default && (
                    <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>
                  )}
                  {isDisabled && (
                    <span className="text-[9px] text-gray-600">selected as {badge === 'A' ? 'B' : 'A'}</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}
                  {Object.keys(v.metrics ?? {}).length > 0 && (
                    <span className="ml-2">
                      {Object.entries(v.metrics).slice(0, 2).map(([k, val]) =>
                        `${k}: ${val <= 1 ? `${(val * 100).toFixed(1)}%` : val.toFixed(3)}`
                      ).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function VersionComparePanel({ versions, currentDeployment, lastInputs }: Props) {
  const sorted = [...versions].sort((a, b) => {
    const av = parseInt(a.mlflow_model_version || '0', 10)
    const bv = parseInt(b.mlflow_model_version || '0', 10)
    return bv - av
  })

  // A = baseline (default: current deployment)
  // B = challenger (default: previous version, or first if only one)
  const defaultA = currentDeployment.id
  const defaultB = sorted.find(v => v.id !== defaultA)?.id ?? ''

  const [versionA, setVersionA] = useState(defaultA)
  const [versionB, setVersionB] = useState(defaultB)
  const [inputsJson, setInputsJson] = useState(
    lastInputs ? JSON.stringify(lastInputs, null, 2) : '{}'
  )
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<{ a: VersionComparison | null; b: VersionComparison | null }>({ a: null, b: null })
  const [derived, setDerived] = useState<DerivedMetricsResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const deployA = sorted.find(v => v.id === versionA)
  const deployB = sorted.find(v => v.id === versionB)
  const schemasMatch = deployA && deployB ? schemasCompatible(deployA, deployB) : true

  const canRun = versionA && versionB && versionA !== versionB

  const runCompare = async () => {
    if (!canRun) return
    setRunning(true)
    setError(null)
    setResults({ a: null, b: null })
    setDerived(null)
    try {
      const inputs = JSON.parse(inputsJson)
      const depIds = [versionA, versionB]
      const [res, dm] = await Promise.all([
        inferenceApi.compareVersions(currentDeployment.trainer_name, inputs, depIds),
        feedbackApi.derivedMetrics(currentDeployment.trainer_name, depIds).catch(() => null),
      ])
      const compA = res.comparisons.find(c => c.deployment_id === versionA) ?? null
      const compB = res.comparisons.find(c => c.deployment_id === versionB) ?? null
      setResults({ a: compA, b: compB })
      if (dm && dm.specs.length > 0) setDerived(dm)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const allKeys = Array.from(new Set([
    ...resultKeys(results.a?.result),
    ...resultKeys(results.b?.result),
  ]))

  const numericKeys = allKeys.filter(k =>
    typeof (results.a?.result as Record<string, unknown>)?.[k] === 'number' ||
    typeof (results.b?.result as Record<string, unknown>)?.[k] === 'number'
  )

  const hasResults = results.a !== null || results.b !== null
  const hasDerived = derived && derived.specs.length > 0

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-gray-200">A / B Comparison</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Select two versions of this model — A is the baseline, B is the challenger.
          Both run against the same inputs and their metrics are compared side by side.
        </p>
      </div>

      {/* Schema mismatch warning */}
      {!schemasMatch && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-400">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            v{deployA?.mlflow_model_version} and v{deployB?.mlflow_model_version} have different
            input schemas — results may not be directly comparable.
          </span>
        </div>
      )}

      {/* Version selectors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VersionPicker
          label="Baseline"
          badge="A"
          badgeColor="bg-brand-900 text-brand-300 border-brand-700"
          versions={sorted}
          selected={versionA}
          disabledId={versionB}
          onChange={setVersionA}
        />
        <VersionPicker
          label="Challenger"
          badge="B"
          badgeColor="bg-emerald-900/60 text-emerald-300 border-emerald-800"
          versions={sorted}
          selected={versionB}
          disabledId={versionA}
          onChange={setVersionB}
        />
      </div>

      {sorted.length < 2 && (
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl p-3 text-xs text-gray-500">
          <Info size={13} className="flex-shrink-0" />
          Only one version deployed. Train or deploy another version to enable A/B comparison.
        </div>
      )}

      {/* Inputs */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Test Inputs (JSON)</h4>
        <textarea
          value={inputsJson}
          onChange={e => setInputsJson(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none"
          placeholder='{"image_b64": "...", "reference": "MTR-001"}'
        />
        {lastInputs != null && (
          <button
            onClick={() => setInputsJson(JSON.stringify(lastInputs, null, 2))}
            className="text-xs text-gray-500 hover:text-brand-400 transition-colors"
          >
            ↺ Restore last inference inputs
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-900 rounded-xl p-3 text-sm text-red-400">
          <AlertCircle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={runCompare}
        disabled={running || !canRun}
        className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
      >
        {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {running
          ? 'Running A and B…'
          : deployA && deployB
          ? `Compare v${deployA.mlflow_model_version} (A)  vs  v${deployB.mlflow_model_version} (B)`
          : 'Select two versions above'}
      </button>

      {/* ── Results ── */}
      {hasResults && (
        <div className="space-y-5">

          {/* ── Derived metrics — primary comparison ── */}
          {hasDerived ? (
            <div className="bg-gray-900 border border-brand-900/50 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <BarChart2 size={14} className="text-brand-400" />
                <span className="text-xs font-semibold text-gray-200 uppercase tracking-widest">
                  Trainer Metrics
                </span>
                <span className="text-[10px] text-gray-500 ml-1">computed from collected feedback</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Metric</th>
                    <th className="text-right px-4 py-2.5 font-mono text-brand-400">
                      A · v{deployA?.mlflow_model_version}
                      {deployA?.is_default && <span className="ml-1 text-[9px] text-emerald-600">★</span>}
                    </th>
                    <th className="text-right px-4 py-2.5 font-mono text-emerald-400">
                      B · v{deployB?.mlflow_model_version}
                      {deployB?.is_default && <span className="ml-1 text-[9px] text-emerald-600">★</span>}
                    </th>
                    <th className="text-right px-4 py-2.5 text-gray-600 font-medium">Δ vs A</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {derived!.specs.map(spec => {
                    const valA = derived!.per_deployment[versionA]?.[spec.key] ?? null
                    const valB = derived!.per_deployment[versionB]?.[spec.key] ?? null

                    const fmt = (v: number | null) => {
                      if (v == null) return '—'
                      return spec.unit === '%'
                        ? `${(v * 100).toFixed(1)}%`
                        : `${v.toFixed(2)}${spec.unit ? ' ' + spec.unit : ''}`
                    }

                    let delta: string | null = null
                    let bWins = false
                    let bLoses = false
                    if (valA != null && valB != null) {
                      const raw = valB - valA
                      const pct = valA !== 0 ? ((raw / valA) * 100).toFixed(1) : null
                      delta = (raw >= 0 ? '+' : '') + fmt(raw) + (pct != null ? ` (${pct}%)` : '')
                      bWins = spec.higher_is_better ? valB > valA : valB < valA
                      bLoses = spec.higher_is_better ? valB < valA : valB > valA
                    }

                    return (
                      <tr key={spec.key} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {spec.higher_is_better
                              ? <TrendingUp size={11} className="text-gray-600" />
                              : <TrendingDown size={11} className="text-gray-600" />}
                            <span className="text-gray-300 font-medium">{spec.label}</span>
                          </div>
                          {spec.description && (
                            <div className="text-[10px] text-gray-600 mt-0.5 ml-4">{spec.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-400">
                          {fmt(valA)}
                        </td>
                        <td className={clsx(
                          'px-4 py-3 text-right font-mono font-semibold',
                          bWins ? 'text-emerald-400' : bLoses ? 'text-red-400' : 'text-gray-300',
                        )}>
                          {fmt(valB)}
                          {bWins && <span className="ml-1 text-[9px] text-emerald-600">▲</span>}
                          {bLoses && <span className="ml-1 text-[9px] text-red-600">▼</span>}
                        </td>
                        <td className={clsx(
                          'px-4 py-3 text-right font-mono text-[11px]',
                          bWins ? 'text-emerald-500' : bLoses ? 'text-red-500' : 'text-gray-600',
                        )}>
                          {delta ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2.5 border-t border-gray-800 text-[10px] text-gray-600 flex items-center gap-1.5">
                <Info size={10} />
                Δ = B minus A. <span className="text-emerald-600">▲ green</span> = B wins,&nbsp;
                <span className="text-red-600">▼ red</span> = B loses.
                Collect more feedback for statistical significance.
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-500">
              <BarChart2 size={14} className="flex-shrink-0 mt-0.5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-400 mb-1">No trainer metrics declared</p>
                <p>Add <code className="bg-gray-800 px-1 rounded text-gray-300">derived_metrics</code> to your trainer to enable EMR, digit accuracy, edit distance, and billing impact comparisons here.
                See the <em>UI Schema → derived_metrics</em> section in the plugin guide.</p>
              </div>
            </div>
          )}

          {/* ── Side-by-side output cards ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Live Output — same inputs, both versions
            </p>
            <div className="grid grid-cols-2 gap-4">
              {([['A', results.a, deployA, 'border-brand-900/40', 'text-brand-400'],
                 ['B', results.b, deployB, 'border-emerald-900/40', 'text-emerald-400']] as const).map(
                ([badge, comp, deploy, borderCls, labelCls]) => (
                  <div key={badge} className={clsx('bg-gray-900 rounded-2xl border overflow-hidden', comp?.error ? 'border-red-900/50' : borderCls)}>
                    <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-[10px] font-bold uppercase tracking-widest', labelCls)}>{badge}</span>
                        <span className={clsx('font-mono text-xs', labelCls)}>v{deploy?.mlflow_model_version}</span>
                        {deploy?.is_default && <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>}
                      </div>
                      {comp
                        ? comp.error
                          ? <XCircle size={13} className="text-red-500" />
                          : <CheckCircle2 size={13} className="text-emerald-500" />
                        : <Loader2 size={13} className="text-gray-600 animate-spin" />}
                    </div>
                    <div className="p-4">
                      {!comp ? (
                        <div className="text-xs text-gray-600">Waiting…</div>
                      ) : comp.error ? (
                        <div className="text-xs text-red-400 font-mono">{comp.error}</div>
                      ) : allKeys.length > 0 ? (
                        <div className="space-y-2">
                          {allKeys.map(key => {
                            const val = (comp.result as Record<string, unknown>)?.[key]
                            return (
                              <div key={key}>
                                <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">{key}</div>
                                <div className="text-sm text-gray-200 font-medium font-mono break-all">
                                  {formatRaw(val)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">
                          {JSON.stringify(comp.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* ── Numeric diff table (secondary) ── */}
          {numericKeys.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <ArrowRight size={13} className="text-gray-600" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                  Numeric Output Fields
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Field</th>
                    <th className="text-right px-4 py-2 text-brand-400 font-mono">
                      A · v{deployA?.mlflow_model_version}
                    </th>
                    <th className="text-right px-4 py-2 text-emerald-400 font-mono">
                      B · v{deployB?.mlflow_model_version}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {numericKeys.map(key => {
                    const va = (results.a?.result as Record<string, unknown>)?.[key] as number | undefined
                    const vb = (results.b?.result as Record<string, unknown>)?.[key] as number | undefined
                    const bHigher = va != null && vb != null && vb > va
                    const bLower = va != null && vb != null && vb < va
                    return (
                      <tr key={key} className="hover:bg-gray-800/40 transition-colors">
                        <td className="px-4 py-2 text-gray-400">{key}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-400">
                          {va != null ? formatRaw(va) : '—'}
                        </td>
                        <td className={clsx(
                          'px-4 py-2 text-right font-mono',
                          bHigher ? 'text-emerald-400 font-semibold' : bLower ? 'text-gray-500' : 'text-gray-300',
                        )}>
                          {vb != null ? formatRaw(vb) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
