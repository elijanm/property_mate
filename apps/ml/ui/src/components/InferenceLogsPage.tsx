import { useState, useEffect, useCallback } from 'react'
import { inferenceApi } from '@/api/inference'
import { trainersApi } from '@/api/trainers'
import type { InferenceLog } from '@/types/inference'
import JobsPanel from './JobsPanel'
import { Trash2, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import clsx from 'clsx'

type Tab = 'inferences' | 'jobs'

export default function InferenceLogsPage() {
  const [tab, setTab] = useState<Tab>('inferences')
  const [logs, setLogs] = useState<InferenceLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [trainerFilter, setTrainerFilter] = useState('')
  const [trainerNames, setTrainerNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    trainersApi.listDeployments().then(deps => {
      const names = [...new Set(deps.map(d => d.trainer_name))]
      setTrainerNames(names)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await inferenceApi.getAllLogs(page, 50, trainerFilter || undefined)
      setLogs(res.items)
      setTotal(res.total)
    } catch {}
    finally { setLoading(false) }
  }, [page, trainerFilter])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    await inferenceApi.deleteLog(id)
    setLogs(prev => prev.filter(l => l.id !== id))
    setTotal(t => t - 1)
  }

  const totalPages = Math.ceil(total / 50) || 1

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'inferences', label: 'Inference Logs', count: total },
    { id: 'jobs',       label: 'Training Jobs' },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300'
            )}>
            {t.label}
            {t.count !== undefined && (
              <span className={clsx('ml-2 text-[10px] px-1.5 py-0.5 rounded-full',
                tab === t.id ? 'bg-brand-900/60 text-brand-400' : 'bg-gray-800 text-gray-600')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Inferences tab ── */}
      {tab === 'inferences' && (
        <>
          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <select value={trainerFilter} onChange={e => { setTrainerFilter(e.target.value); setPage(1) }}
              className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500">
              <option value="">All Trainers</option>
              {trainerNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-xl text-gray-400 hover:text-gray-200 disabled:opacity-40">
              <Loader2 size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <span className="text-xs text-gray-600 ml-auto">{total} total inference{total !== 1 ? 's' : ''}</span>
          </div>

          {logs.length === 0 && !loading && (
            <div className="text-center py-16 text-gray-600 text-sm">No inference logs yet.</div>
          )}

          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className={clsx('bg-gray-900 rounded-2xl border overflow-hidden', log.error ? 'border-red-900/40' : 'border-gray-800')}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(expanded === log.id ? null : log.id)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                    {expanded === log.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {log.error ? <AlertCircle size={13} className="text-red-400 flex-shrink-0" /> : <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-brand-400">{log.trainer_name}</span>
                      {log.model_version && <span className="text-[10px] text-gray-600">v{log.model_version}</span>}
                      {!!log.corrected_output && <span className="text-[9px] bg-amber-900/50 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-800">corrected</span>}
                      {log.error && <span className="text-[10px] text-red-500 truncate max-w-xs">{log.error}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-600">
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                      {log.latency_ms != null && <span>{log.latency_ms.toFixed(0)}ms</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(log.id)} className="text-gray-700 hover:text-red-400 flex-shrink-0"><Trash2 size={13} /></button>
                </div>
                {expanded === log.id && (
                  <div className="border-t border-gray-800 px-4 py-3 space-y-3">
                    <div>
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Output</p>
                      <pre className="text-xs font-mono text-gray-300 bg-gray-950 rounded-xl p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                        {JSON.stringify(log.outputs, null, 2)}
                      </pre>
                    </div>
                    {!!log.corrected_output && (
                      <div>
                        <p className="text-[10px] text-amber-600 uppercase tracking-widest mb-1.5">Corrected Output</p>
                        <pre className="text-xs font-mono text-amber-300 bg-amber-950/20 rounded-xl p-3 overflow-auto max-h-32 whitespace-pre-wrap">
                          {JSON.stringify(log.corrected_output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                Prev
              </button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Jobs tab ── */}
      {tab === 'jobs' && <JobsPanel />}
    </div>
  )
}
