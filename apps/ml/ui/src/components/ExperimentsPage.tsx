import { useState, useEffect } from 'react'
import { experimentsApi } from '../api/experiments'
import { GitCompare, RefreshCw, RotateCcw, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface Experiment { id: string; name: string; lifecycle_stage: string }
interface Run { run_id: string; name: string; status: string; start_time: number; metrics: Record<string, number>; params: Record<string, string> }
interface CBState { state: string; failures: number; successes?: number }

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [selectedExp, setSelectedExp] = useState<string>('')
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set())
  const [comparison, setComparison] = useState<{ runs: Run[]; metric_keys: string[]; param_keys: string[] } | null>(null)
  const [circuitBreakers, setCircuitBreakers] = useState<Record<string, CBState>>({})
  const [tab, setTab] = useState<'runs' | 'circuit'>('runs')
  const [loading, setLoading] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [comparing, setComparing] = useState(false)

  useEffect(() => {
    Promise.all([experimentsApi.list(), experimentsApi.circuitBreakers()])
      .then(([exps, cbs]) => { setExperiments(exps); setCircuitBreakers(cbs) })
      .finally(() => setLoading(false))
  }, [])

  const loadRuns = async (expId: string) => {
    setSelectedExp(expId)
    setLoadingRuns(true)
    setRuns([])
    setSelectedRuns(new Set())
    setComparison(null)
    try { setRuns(await experimentsApi.listRuns(expId) as Run[]) }
    catch {} finally { setLoadingRuns(false) }
  }

  const compare = async () => {
    if (selectedRuns.size < 2) return
    setComparing(true)
    try {
      setComparison(await experimentsApi.compare([...selectedRuns]) as { runs: Run[]; metric_keys: string[]; param_keys: string[] })
    }
    catch {} finally { setComparing(false) }
  }

  const resetCB = async (trainer: string) => {
    await experimentsApi.resetCircuitBreaker(trainer)
    const updated = await experimentsApi.circuitBreakers()
    setCircuitBreakers(updated)
  }

  const toggleRun = (id: string) => {
    setSelectedRuns(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const CB_COLOR: Record<string, string> = {
    closed: 'text-emerald-400 border-emerald-800 bg-emerald-900/10',
    open: 'text-red-400 border-red-800 bg-red-900/10',
    'half-open': 'text-yellow-400 border-yellow-800 bg-yellow-900/10',
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Experiments &amp; Circuit Breakers</h2>
        </div>
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {(['runs', 'circuit'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-3 py-1.5 text-xs capitalize transition-colors', tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300')}>
              {t === 'runs' ? 'Run comparison' : 'Circuit breakers'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'runs' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <select value={selectedExp} onChange={e => loadRuns(e.target.value)} disabled={loading}
              className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none">
              <option value="">Select experiment…</option>
              {experiments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {selectedRuns.size >= 2 && (
              <button onClick={compare} disabled={comparing}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-xl transition-colors disabled:opacity-50">
                {comparing ? <Loader2 size={12} className="animate-spin" /> : <GitCompare size={12} />}
                Compare {selectedRuns.size} runs
              </button>
            )}
          </div>

          {loadingRuns ? (
            <div className="flex justify-center h-24 items-center"><Loader2 size={16} className="animate-spin text-gray-600" /></div>
          ) : runs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/50 border-b border-gray-800">
                    <th className="w-8 px-3 py-2.5"></th>
                    {['Run', 'Status', 'Started', ...Object.keys(runs[0]?.metrics ?? {}).slice(0, 4)].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {runs.map(run => (
                    <tr key={run.run_id} className={clsx('hover:bg-gray-800/30 transition-colors cursor-pointer', selectedRuns.has(run.run_id) && 'bg-brand-900/20')}
                      onClick={() => toggleRun(run.run_id)}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selectedRuns.has(run.run_id)} readOnly
                          className="rounded bg-gray-800 border-gray-600 accent-brand-500" />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-300">{run.name}</td>
                      <td className="px-3 py-2.5">
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', run.status === 'FINISHED' ? 'text-emerald-400 bg-emerald-900/20' : 'text-gray-500 bg-gray-800')}>{run.status}</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{run.start_time ? new Date(run.start_time).toLocaleString() : '—'}</td>
                      {Object.values(run.metrics ?? {}).slice(0, 4).map((v, i) => (
                        <td key={i} className="px-3 py-2.5 font-mono text-gray-400">{typeof v === 'number' ? v.toFixed(4) : String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {comparison && (
            <div className="bg-gray-900 border border-brand-800/40 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 bg-brand-900/10">
                <span className="text-sm font-medium text-brand-300">Side-by-side comparison</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/50 border-b border-gray-800">
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Metric</th>
                      {comparison.runs.map((r: Run) => (
                        <th key={r.run_id} className="px-4 py-2.5 text-left text-gray-300 font-medium">{(r.name ?? r.run_id).slice(0, 12)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {comparison.metric_keys.map(k => {
                      const vals = comparison.runs.map((r: Run) => r.metrics?.[k])
                      const numVals = vals.filter((v): v is number => typeof v === 'number')
                      const best = numVals.length ? Math.max(...numVals) : null
                      return (
                        <tr key={k} className="hover:bg-gray-800/20">
                          <td className="px-4 py-2 text-gray-400 font-mono">{k}</td>
                          {comparison.runs.map((r: Run) => {
                            const v = r.metrics?.[k]
                            const isBest = v === best
                            return (
                              <td key={r.run_id} className={clsx('px-4 py-2 font-mono', isBest ? 'text-emerald-400' : 'text-gray-400')}>
                                {typeof v === 'number' ? v.toFixed(4) : '—'}
                                {isBest && <span className="ml-1 text-[10px]">&#9733;</span>}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'circuit' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Circuit breakers automatically suspend failing models. Opens after 5 consecutive failures, recovers after 2 minutes.</p>
          {Object.keys(circuitBreakers).length === 0 ? (
            <div className="text-center py-10 text-gray-600 text-sm">No circuit breaker state recorded — all models healthy</div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {Object.entries(circuitBreakers).map(([trainer, cb]) => (
                <div key={trainer} className={clsx('flex items-center justify-between bg-gray-900 border rounded-xl px-4 py-3', CB_COLOR[cb.state] ?? 'text-gray-400 border-gray-800')}>
                  <div>
                    <div className="text-sm font-medium text-white">{trainer}</div>
                    <div className="text-xs mt-0.5 flex gap-3">
                      <span>State: <span className="font-medium">{cb.state}</span></span>
                      <span>Failures: {cb.failures}</span>
                      {cb.successes !== undefined && <span>Successes (half-open): {cb.successes}</span>}
                    </div>
                  </div>
                  {cb.state !== 'closed' && (
                    <button onClick={() => resetCB(trainer)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
                      <RotateCcw size={12} /> Reset
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <button onClick={async () => setCircuitBreakers(await experimentsApi.circuitBreakers())}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-lg hover:text-gray-200 transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      )}
    </div>
  )
}
