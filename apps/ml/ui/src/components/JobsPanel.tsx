import { useState, useEffect, useCallback, useRef } from 'react'
import { trainersApi } from '@/api/trainers'
import type { TrainingJob } from '@/types/trainer'
import StatusBadge from './StatusBadge'
import { Trash2, RefreshCw, XCircle, ChevronDown, ChevronRight, ChevronLeft, Terminal, Loader2, Monitor, Zap, Clock, DollarSign, Cpu, Activity } from 'lucide-react'
import clsx from 'clsx'

const JOBS_PER_PAGE = 10

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  const secs = Math.floor((end - start) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem  = secs % 60
  if (mins < 60) return `${mins}m ${rem}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function CloudCostBadge({ job }: { job: TrainingJob }) {
  const [elapsed, setElapsed] = useState(0)

  // Tick every second while job is running so cost updates live
  useEffect(() => {
    if (job.status !== 'running' || !job.started_at) return
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(job.started_at!).getTime()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [job.status, job.started_at])

  const ratePerSec = job.gpu_price_per_hour ? job.gpu_price_per_hour / 3600 : null
  const isTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'

  // Final charge shown after completion
  if (job.wallet_charged > 0) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <DollarSign size={9} /> ${job.wallet_charged.toFixed(12)} charged
      </span>
    )
  }

  // Live accruing cost while running
  if (job.status === 'running' && job.started_at && ratePerSec) {
    const accrued = ratePerSec * elapsed
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-400">
        <DollarSign size={9} />
        <span className="tabular-nums">${accrued.toFixed(12)}</span>
        <span className="text-gray-600">/ ${job.wallet_reserved.toFixed(12)} reserved</span>
        <span className="text-gray-700">· ${ratePerSec.toFixed(12)}/s</span>
      </span>
    )
  }

  // For terminal jobs with reserved but no charge yet (billing pending) — estimate from duration
  if (isTerminal && job.wallet_reserved > 0 && ratePerSec && job.started_at && job.finished_at) {
    const durationSecs = Math.max(1, Math.floor((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000))
    const estimated = ratePerSec * durationSecs
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <DollarSign size={9} /> ~${estimated.toFixed(12)} est.
        <span className="text-gray-600">({durationSecs}s × ${ratePerSec.toFixed(12)}/s)</span>
      </span>
    )
  }

  // Reserved — queued or running without a rate yet
  if (!isTerminal && job.wallet_reserved > 0) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-500">
        <DollarSign size={9} /> ${job.wallet_reserved.toFixed(12)} reserved
        {ratePerSec && <span className="text-gray-600">· ${ratePerSec.toFixed(12)}/s</span>}
      </span>
    )
  }

  return null
}

interface Props {
  trainerName?: string  // if undefined, shows all jobs
  onJobCompleted?: (job: TrainingJob) => void
}

export default function JobsPanel({ trainerName, onJobCompleted }: Props) {
  const [jobs, setJobs] = useState<TrainingJob[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevStatusRef = useRef<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await trainersApi.listJobs(trainerName)
      setJobs(data)
      // Detect jobs that just completed
      if (onJobCompleted) {
        for (const job of data) {
          const prev = prevStatusRef.current[job.id]
          if (prev && prev !== 'completed' && job.status === 'completed') {
            onJobCompleted(job)
          }
        }
      }
      prevStatusRef.current = Object.fromEntries(data.map(j => [j.id, j.status]))
    } catch {}
    finally { setLoading(false) }
  }, [trainerName, onJobCompleted])

  useEffect(() => {
    load()
    // Auto-refresh every 4s while any job is running/queued
    intervalRef.current = setInterval(() => {
      setJobs(prev => {
        const hasActive = prev.some(j => j.status === 'running' || j.status === 'queued')
        if (hasActive) load()
        return prev
      })
    }, 4000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load])

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await trainersApi.deleteJob(id)
      setJobs(prev => prev.filter(j => j.id !== id))
    } finally { setDeleting(null) }
  }

  const handleCancel = async (id: string) => {
    await trainersApi.cancelJob(id)
    await load()
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete all jobs' + (trainerName ? ` for ${trainerName}` : '') + '?')) return
    await trainersApi.deleteAllJobs(trainerName)
    setJobs([])
  }

  const totalPages = Math.max(1, Math.ceil(jobs.length / JOBS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const paginated = jobs.slice((safePage - 1) * JOBS_PER_PAGE, safePage * JOBS_PER_PAGE)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {jobs.length} job{jobs.length !== 1 ? 's' : ''}
          {totalPages > 1 && ` · page ${safePage}/${totalPages}`}
        </p>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="text-gray-600 hover:text-gray-300 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {jobs.length > 0 && (
            <button onClick={handleDeleteAll}
              className="text-[10px] text-red-600 hover:text-red-400 px-2 py-1 border border-red-900/50 rounded-lg">
              Delete all
            </button>
          )}
        </div>
      </div>

      {jobs.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-600 text-sm">No training jobs.</div>
      )}

      {paginated.map(job => (
        <div key={job.id} className={clsx('bg-gray-900 rounded-2xl border overflow-hidden', {
          'border-blue-800/60': job.status === 'running',
          'border-purple-800/40': job.status === 'queued',
          'border-red-900/40': job.status === 'failed',
          'border-gray-800': job.status === 'completed' || job.status === 'cancelled',
        })}>
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => setExpanded(expanded === job.id ? null : job.id)}
              className="text-gray-500 hover:text-gray-300 flex-shrink-0">
              {expanded === job.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-200 truncate">{job.trainer_name}</span>
                <StatusBadge status={job.status} />
                {(job.status === 'running' || job.status === 'queued') && (
                  <Loader2 size={11} className="animate-spin text-blue-400" />
                )}
              </div>
              <div className="text-[10px] text-gray-600 mt-0.5">
                {job.trigger} · {job.created_at ? new Date(job.created_at).toLocaleString() : ''}
              </div>

              {/* Run info: where · duration · cost */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {/* Where */}
                {job.compute_type === 'cloud_gpu' ? (
                  <span className="flex items-center gap-1 text-[10px] text-violet-400">
                    <Zap size={9} />
                    {job.gpu_type_id
                      ? job.gpu_type_id.replace('NVIDIA ', '').replace('GeForce ', '')
                      : 'Cloud GPU'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Monitor size={9} /> Local
                  </span>
                )}

                {/* Duration */}
                {(job.started_at || job.status === 'running') && (() => {
                  const dur = formatDuration(job.started_at, job.finished_at)
                  return dur ? (
                    <span className="flex items-center gap-1 text-[10px] text-gray-500">
                      <Clock size={9} /> {dur}
                      {job.status === 'running' && <span className="text-blue-500">…</span>}
                    </span>
                  ) : null
                })()}

                {/* Cost */}
                {(() => {
                  const badge = <CloudCostBadge job={job} />
                  if (badge) return badge
                  // Only show "Free" once the job is terminal and nothing was charged
                  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                    return (
                      <span className="flex items-center gap-1 text-[10px] text-gray-600">
                        <DollarSign size={9} /> Free
                      </span>
                    )
                  }
                  return null
                })()}
              </div>

              {Object.keys(job.metrics ?? {}).length > 0 && (
                <div className="flex gap-3 mt-1">
                  {Object.entries(job.metrics).slice(0, 3).map(([k, v]) => (
                    <span key={k} className="text-[10px] text-brand-400">
                      {k}: {typeof v === 'number' && v <= 1 ? `${(v * 100).toFixed(1)}%` : String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {(job.status === 'queued' || job.status === 'running') && (
                <button onClick={() => handleCancel(job.id)}
                  className="p-1.5 text-gray-600 hover:text-yellow-400 rounded-lg hover:bg-gray-800"
                  title="Cancel">
                  <XCircle size={13} />
                </button>
              )}
              <button
                onClick={() => handleDelete(job.id)}
                disabled={deleting === job.id}
                className="p-1.5 text-gray-700 hover:text-red-400 rounded-lg hover:bg-gray-800 disabled:opacity-40">
                {deleting === job.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </div>
          </div>

          {expanded === job.id && (
            <div className="border-t border-gray-800 px-4 py-3 space-y-3">
              {job.error && (
                <div className="bg-red-950/40 border border-red-900/40 rounded-xl p-3 text-xs text-red-400 font-mono">{job.error}</div>
              )}
              {job.model_uri && (
                <div className="text-[10px] text-gray-600 font-mono truncate">model: {job.model_uri}</div>
              )}

              {/* Pod / system runtime metrics */}
              {job.pod_metrics && Object.keys(job.pod_metrics).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity size={11} className="text-gray-600" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {job.compute_type === 'cloud_gpu' ? 'Pod metrics' : 'System metrics'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {job.pod_metrics.gpu_util_pct != null && (
                      <span className="text-[10px] text-violet-400 flex items-center gap-1">
                        <Zap size={9} /> GPU {job.pod_metrics.gpu_util_pct}%
                      </span>
                    )}
                    {job.pod_metrics.gpu_mem_util_pct != null && (
                      <span className="text-[10px] text-violet-300 flex items-center gap-1">
                        <Zap size={9} /> VRAM {job.pod_metrics.gpu_mem_util_pct}%
                      </span>
                    )}
                    {job.pod_metrics.cpu_pct != null && (
                      <span className="text-[10px] text-blue-400 flex items-center gap-1">
                        <Cpu size={9} /> CPU {job.pod_metrics.cpu_pct}%
                      </span>
                    )}
                    {job.pod_metrics.memory_pct != null && (
                      <span className="text-[10px] text-blue-300 flex items-center gap-1">
                        <Cpu size={9} /> RAM {job.pod_metrics.memory_pct}%
                      </span>
                    )}
                    {job.pod_metrics.uptime_seconds != null && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1">
                        <Clock size={9} /> uptime {job.pod_metrics.uptime_seconds}s
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Cost log */}
              {job.cost_log && job.cost_log.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign size={11} className="text-gray-600" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">Cost log</span>
                  </div>
                  <div className="bg-gray-950 rounded-xl p-2 max-h-32 overflow-y-auto font-mono text-[10px] text-gray-500 space-y-0.5">
                    {job.cost_log.map((snap, i) => (
                      <div key={i} className={clsx('flex gap-3', snap.final && 'text-emerald-400')}>
                        <span className="w-16 tabular-nums">{snap.elapsed_s}s</span>
                        <span className="tabular-nums text-amber-400">${snap.accrued_usd.toFixed(12)}</span>
                        {snap.gpu_util_pct != null && (
                          <span className="text-violet-500">GPU {snap.gpu_util_pct}%</span>
                        )}
                        {snap.final && <span className="text-emerald-500">● final</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {job.log_lines?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Terminal size={11} className="text-gray-600" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest">Logs</span>
                  </div>
                  <div className="bg-gray-950 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[11px] text-gray-400 space-y-0.5">
                    {job.log_lines.slice(-100).map((line, i) => (
                      <div key={i} className={clsx(
                        line.includes('[bootstrap]') && 'text-gray-600',
                        line.includes('error') || line.includes('Error') ? 'text-red-400' : '',
                        line.startsWith('{"metrics"') && 'text-emerald-400',
                      )}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
            <ChevronLeft size={12} /> Prev
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                acc.push(p); return acc
              }, [])
              .map((p, i) => p === '...'
                ? <span key={`e${i}`} className="px-1 text-xs text-gray-600">…</span>
                : <button key={p} onClick={() => setPage(p as number)}
                    className={clsx('w-7 h-7 text-xs rounded-lg transition-colors',
                      p === safePage ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
                    {p}
                  </button>
              )}
          </div>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
            Next <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
