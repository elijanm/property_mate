import { useState } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import type { VersionComparison } from '@/types/inference'
import { inferenceApi } from '@/api/inference'
import {
  GitCompare, Play, Loader2, CheckSquare, Square, AlertCircle,
  CheckCircle2, XCircle, Info,
} from 'lucide-react'
import clsx from 'clsx'

interface Props {
  versions: ModelDeployment[]
  currentDeployment: ModelDeployment
  lastInputs: unknown  // inputs from the last inference run, pre-populated
}

function schemasCompatible(a: ModelDeployment, b: ModelDeployment): boolean {
  const ka = Object.keys(a.input_schema ?? {}).sort()
  const kb = Object.keys(b.input_schema ?? {}).sort()
  return ka.join(',') === kb.join(',')
}

function formatValue(val: unknown): string {
  if (val == null) return '—'
  if (typeof val === 'number') {
    return val <= 1 && val >= 0 ? `${(val * 100).toFixed(1)}%` : val.toFixed(4)
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

// Collect all top-level keys from a result object
function resultKeys(result: unknown): string[] {
  if (result == null || typeof result !== 'object') return []
  return Object.keys(result as object)
}

export default function VersionComparePanel({ versions, currentDeployment, lastInputs }: Props) {
  const sorted = [...versions].sort((a, b) => {
    const av = parseInt(a.mlflow_model_version || '0', 10)
    const bv = parseInt(b.mlflow_model_version || '0', 10)
    return bv - av
  })

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sorted.map(v => v.id))
  )
  const [inputsJson, setInputsJson] = useState(
    lastInputs ? JSON.stringify(lastInputs, null, 2) : '{}'
  )
  const [running, setRunning] = useState(false)
  const [comparisons, setComparisons] = useState<VersionComparison[]>([])
  const [error, setError] = useState<string | null>(null)

  const toggleVersion = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  const runCompare = async () => {
    setRunning(true)
    setError(null)
    setComparisons([])
    try {
      const inputs = JSON.parse(inputsJson)
      const res = await inferenceApi.compareVersions(
        currentDeployment.trainer_name,
        inputs,
        [...selected],
      )
      setComparisons(res.comparisons)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const incompatible = sorted.filter(
    v => v.id !== currentDeployment.id && !schemasCompatible(currentDeployment, v)
  )

  // All keys across all successful results
  const allKeys = Array.from(
    new Set(comparisons.flatMap(c => resultKeys(c.result)))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <GitCompare size={16} className="text-brand-500 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Version Comparison</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Run the same inputs against multiple versions simultaneously to compare outputs.
          </p>
        </div>
      </div>

      {incompatible.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-400">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            {incompatible.map(v => `v${v.mlflow_model_version}`).join(', ')} have a different input schema —
            they may produce unexpected results with these inputs.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Version selector */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Versions to compare
          </h4>
          <div className="space-y-2">
            {sorted.map(v => {
              const isSelected = selected.has(v.id)
              const compatible = schemasCompatible(currentDeployment, v)
              return (
                <button
                  key={v.id}
                  onClick={() => toggleVersion(v.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors',
                    isSelected
                      ? 'bg-brand-900/30 border-brand-700 text-gray-200'
                      : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'
                  )}
                >
                  {isSelected ? <CheckSquare size={14} className="text-brand-400 flex-shrink-0" /> : <Square size={14} className="flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-brand-400">v{v.mlflow_model_version}</span>
                      {v.is_default && <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>}
                      {!compatible && (
                        <span className="text-[9px] text-amber-500">schema differs</span>
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

        {/* Inputs */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Inputs (JSON)
          </h4>
          <textarea
            value={inputsJson}
            onChange={e => setInputsJson(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none"
            placeholder='{"sepal_length": 5.1, "sepal_width": 3.5, ...}'
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
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-900 rounded-xl p-3 text-sm text-red-400">
          <AlertCircle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={runCompare}
        disabled={running || selected.size < 1}
        className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
      >
        {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {running ? `Running across ${selected.size} versions…` : `Compare ${selected.size} versions`}
      </button>

      {/* Results table */}
      {comparisons.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Results</h4>

          {/* Side-by-side cards */}
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(comparisons.length, 3)}, 1fr)` }}>
            {comparisons.map(c => (
              <div
                key={c.deployment_id}
                className={clsx(
                  'bg-gray-900 rounded-2xl border overflow-hidden',
                  c.error ? 'border-red-900/50' : 'border-gray-800'
                )}
              >
                {/* Version header */}
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-brand-400">v{c.version}</span>
                    {c.is_default && (
                      <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>
                    )}
                  </div>
                  {c.error
                    ? <XCircle size={14} className="text-red-500" />
                    : <CheckCircle2 size={14} className="text-emerald-500" />
                  }
                </div>

                {/* Content */}
                <div className="p-4">
                  {c.error ? (
                    <div className="text-xs text-red-400 font-mono">{c.error}</div>
                  ) : allKeys.length > 0 ? (
                    <div className="space-y-2">
                      {allKeys.map(key => {
                        const val = (c.result as Record<string, unknown>)?.[key]
                        return (
                          <div key={key}>
                            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">{key}</div>
                            <div className="text-sm text-gray-200 font-medium font-mono break-all">
                              {formatValue(val)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(c.result, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Diff table for numeric fields */}
          {(() => {
            const numericKeys = allKeys.filter(k => {
              return comparisons.some(c => {
                const v = (c.result as Record<string, unknown>)?.[k]
                return typeof v === 'number'
              })
            })
            if (numericKeys.length === 0 || comparisons.length < 2) return null
            return (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Numeric Comparison</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-2 text-gray-600 font-medium">Field</th>
                        {comparisons.map(c => (
                          <th key={c.deployment_id} className="text-right px-4 py-2 text-brand-400 font-mono">
                            v{c.version}
                            {c.is_default && <span className="ml-1 text-emerald-600 text-[9px]">★</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {numericKeys.map(key => {
                        const vals = comparisons.map(c =>
                          (c.result as Record<string, unknown>)?.[key] as number | undefined
                        )
                        const max = Math.max(...vals.filter(v => v != null) as number[])
                        return (
                          <tr key={key} className="hover:bg-gray-800/40 transition-colors">
                            <td className="px-4 py-2 text-gray-400 font-medium">{key}</td>
                            {vals.map((val, i) => (
                              <td key={i} className={clsx(
                                'px-4 py-2 text-right font-mono',
                                val === max ? 'text-emerald-400 font-semibold' : 'text-gray-300'
                              )}>
                                {val != null ? formatValue(val) : '—'}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
