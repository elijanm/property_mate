import { useState, useEffect, useCallback } from 'react'
import { inferenceApi } from '@/api/inference'
import type { InferenceLog } from '@/types/inference'
import type { ModelDeployment } from '@/types/trainer'
import OutputRenderer from './OutputRenderer'
import VersionDropdown from './VersionDropdown'
import { Clock, Trash2, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
  refreshTrigger: number
}

export default function InferenceHistoryPanel({ deployment, allDeployments, refreshTrigger }: Props) {
  const [selectedDeploy, setSelectedDeploy] = useState<ModelDeployment>(deployment)
  const [logs, setLogs] = useState<InferenceLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await inferenceApi.getLogs(deployment.trainer_name, page, 50, selectedDeploy.id)
      setLogs(res.items)
      setTotal(res.total)
    } catch {}
    finally { setLoading(false) }
  }, [deployment.trainer_name, page, selectedDeploy.id])

  useEffect(() => { load() }, [load, refreshTrigger])

  const handleDelete = async (id: string) => {
    await inferenceApi.deleteLog(id)
    setLogs(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  const handleCorrect = async (logId: string, corrected: Record<string, unknown>) => {
    setCorrecting(logId)
    try {
      const updated = await inferenceApi.correctLog(logId, corrected)
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, corrected_output: updated.corrected_output } : l))
    } finally { setCorrecting(null) }
  }

  if (loading && logs.length === 0) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-600" /></div>
  }

  return (
    <div className="space-y-3">
      {allDeployments && (
        <VersionDropdown
          deployments={allDeployments}
          selected={selectedDeploy}
          onChange={d => { setSelectedDeploy(d); setPage(1) }}
          label="Logs for version:"
        />
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{total} inference{total !== 1 ? 's' : ''} recorded</p>
        <button onClick={load} disabled={loading}
          className="text-xs text-gray-600 hover:text-gray-400 disabled:opacity-40">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {logs.length === 0 && (
        <div className="text-center py-16 text-gray-600 text-sm">No inferences yet.</div>
      )}

      {logs.map(log => (
        <div key={log.id} className={clsx('bg-gray-900 rounded-2xl border overflow-hidden', log.error ? 'border-red-900/50' : 'border-gray-800')}>
          {/* Row header */}
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              className="text-gray-500 hover:text-gray-300 flex-shrink-0">
              {expanded === log.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {log.error
              ? <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              : <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-200 truncate">
                  {log.error ? 'Error' : extractReadableLabel(log.outputs)}
                </span>
                {!!log.corrected_output && (
                  <span className="text-[9px] bg-amber-900/50 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-800">corrected</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Clock size={10} className="text-gray-600" />
                <span className="text-[10px] text-gray-600">{new Date(log.created_at).toLocaleString()}</span>
                {log.latency_ms != null && (
                  <span className="text-[10px] text-gray-600">{log.latency_ms.toFixed(0)}ms</span>
                )}
                {log.model_version && (
                  <span className="text-[10px] text-gray-700">v{log.model_version}</span>
                )}
              </div>
            </div>
            <button onClick={() => handleDelete(log.id)}
              className="text-gray-700 hover:text-red-400 transition-colors flex-shrink-0">
              <Trash2 size={13} />
            </button>
          </div>

          {/* Expanded view */}
          {expanded === log.id && (
            <div className="border-t border-gray-800 px-4 py-4 space-y-4">
              {log.error && (
                <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3 text-sm text-red-400">{log.error}</div>
              )}

              {/* Inputs */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">Inputs</p>
                <InputSummary inputs={log.inputs} />
              </div>

              {/* Outputs */}
              {!log.error && !!log.outputs && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-2">Output</p>
                  <OutputRenderer
                    outputSchema={deployment.output_schema ?? {}}
                    output={log.outputs}
                    correctedOutput={log.corrected_output}
                    onCorrect={correcting === log.id ? undefined : (c) => handleCorrect(log.id, c)}
                  />
                  {correcting === log.id && (
                    <div className="flex items-center gap-2 text-xs text-brand-400 mt-2">
                      <Loader2 size={12} className="animate-spin" /> Saving correction…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40">
            Prev
          </button>
          <span className="text-xs text-gray-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function extractReadableLabel(outputs: unknown): string {
  if (!outputs || typeof outputs !== 'object') return 'Result'
  const o = outputs as Record<string, unknown>
  if (o.prediction && typeof o.prediction === 'object') {
    const p = o.prediction as Record<string, unknown>
    if (p.reading) return `Reading: ${p.reading}`
  }
  if (o.reading) return `Reading: ${o.reading}`
  if (o.label) return `Label: ${o.label}`
  if (o.class) return `Class: ${o.class}`
  return 'Result'
}

function InputSummary({ inputs }: { inputs: unknown }) {
  if (!inputs || typeof inputs !== 'object') return <span className="text-xs text-gray-600">—</span>
  const obj = inputs as Record<string, unknown>
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(obj).map(([k, v]) => {
        // Skip base64 blobs
        if (typeof v === 'string' && v.length > 100) {
          return <span key={k} className="text-[10px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded">{k}: [binary]</span>
        }
        if (v === null || v === undefined) return null
        return (
          <span key={k} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
            {k}: <span className="text-gray-200">{String(v)}</span>
          </span>
        )
      })}
    </div>
  )
}
