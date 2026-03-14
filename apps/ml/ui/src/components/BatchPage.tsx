import { useState, useEffect, useRef } from 'react'
import { batchApi, type BatchJob } from '../api/batch'
import { Layers, Play, RefreshCw, Download, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react'
import clsx from 'clsx'

const STATUS_ICON: Record<BatchJob['status'], React.ReactNode> = {
  queued: <Clock size={13} className="text-gray-400" />,
  running: <Loader2 size={13} className="animate-spin text-brand-400" />,
  completed: <CheckCircle size={13} className="text-emerald-400" />,
  failed: <XCircle size={13} className="text-red-400" />,
}

export default function BatchPage() {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'jobs' | 'submit'>('jobs')
  const [trainerName, setTrainerName] = useState('')
  const [jsonInput, setJsonInput] = useState('[\n  {"feature1": 1.0, "feature2": 2.0}\n]')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [selectedJob, setSelectedJob] = useState<BatchJob | null>(null)
  const [results, setResults] = useState<{ input: unknown; output: unknown; error: string | null }[]>([])
  const [loadingResults, setLoadingResults] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    try { setJobs(await batchApi.list()) }
    catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    pollingRef.current = setInterval(load, 5000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  const handleSubmit = async () => {
    if (!trainerName) { setError('Trainer name is required'); return }
    let rows: Record<string, unknown>[]
    try { rows = JSON.parse(jsonInput) } catch { setError('Invalid JSON'); return }
    if (!Array.isArray(rows)) { setError('Input must be a JSON array'); return }
    setError('')
    setSubmitting(true)
    try {
      await batchApi.submit(trainerName, rows)
      setTab('jobs')
      await load()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Submission failed') }
    finally { setSubmitting(false) }
  }

  const loadResults = async (job: BatchJob) => {
    setSelectedJob(job)
    setLoadingResults(true)
    try { setResults((await batchApi.getResults(job.id)).results) }
    catch {} finally { setLoadingResults(false) }
  }

  const downloadResults = () => {
    if (!results.length || !selectedJob) return
    const blob = new Blob([results.map(r => JSON.stringify(r)).join('\n')], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `batch_${selectedJob.id}.jsonl`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Batch Inference</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {(['jobs', 'submit'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={clsx('px-3 py-1.5 text-xs capitalize transition-colors', tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300')}>
                {t === 'jobs' ? `Jobs (${jobs.length})` : 'New batch'}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-1.5 text-gray-500 hover:text-gray-300 bg-gray-900 border border-gray-800 rounded-lg"><RefreshCw size={12} /></button>
        </div>
      </div>

      {tab === 'submit' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Trainer name</label>
            <input value={trainerName} onChange={e => setTrainerName(e.target.value)}
              placeholder="e.g. water_meter_ocr" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Input rows (JSON array — max 10,000)</label>
            <textarea value={jsonInput} onChange={e => setJsonInput(e.target.value)} rows={8}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none resize-y" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg disabled:opacity-50 transition-colors">
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Submit batch
          </button>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="grid grid-cols-1 gap-4">
          {loading ? (
            <div className="flex justify-center h-24 items-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-600 text-sm">No batch jobs yet</div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/50 border-b border-gray-800">
                    {['Status', 'Trainer', 'Progress', 'Rows', 'Submitted', 'Completed', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {jobs.map(j => (
                    <tr key={j.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">{STATUS_ICON[j.status] ?? null}</td>
                      <td className="px-4 py-3 text-gray-300 font-mono">{j.trainer_name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className={clsx('h-full rounded-full transition-all', j.status === 'failed' ? 'bg-red-500' : 'bg-brand-500')} style={{ width: `${j.progress_pct}%` }} />
                          </div>
                          <span className="text-gray-500">{j.progress_pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {j.processed_rows}/{j.total_rows}{' '}
                        {j.failed_rows > 0 && <span className="text-red-400">({j.failed_rows} failed)</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{new Date(j.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-600">{j.completed_at ? new Date(j.completed_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3">
                        {j.status === 'completed' && (
                          <button onClick={() => loadResults(j)} className="px-2 py-1 text-[10px] text-brand-400 hover:text-brand-300 bg-gray-800 rounded transition-colors">View</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedJob && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-sm font-medium text-white">Results — {selectedJob.trainer_name}</span>
            <div className="flex gap-2">
              <button onClick={downloadResults} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors">
                <Download size={12} /> Download JSONL
              </button>
              <button onClick={() => setSelectedJob(null)} className="text-gray-600 hover:text-gray-300 px-2">&#x2715;</button>
            </div>
          </div>
          {loadingResults ? (
            <div className="flex justify-center h-20 items-center"><Loader2 size={16} className="animate-spin text-gray-600" /></div>
          ) : (
            <div className="overflow-y-auto max-h-64 divide-y divide-gray-800">
              {results.slice(0, 100).map((r, i) => (
                <div key={i} className={clsx('px-4 py-2 text-xs font-mono', r.error ? 'bg-red-950/20' : '')}>
                  <span className="text-gray-500 w-8 inline-block">{i + 1}.</span>
                  {r.error
                    ? <span className="text-red-400">{r.error}</span>
                    : <span className="text-emerald-300">{JSON.stringify(r.output)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
