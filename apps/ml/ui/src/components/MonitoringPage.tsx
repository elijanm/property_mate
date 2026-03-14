import { useState, useEffect, useCallback } from 'react'
import { monitoringApi } from '../api/monitoring'
import {
  Activity, AlertTriangle, CheckCircle, Clock, RefreshCw,
  TrendingUp, Zap, Database, ChevronDown, ChevronUp
} from 'lucide-react'
import clsx from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelSummary {
  trainer_name: string
  total_requests: number
  error_count: number
  error_rate: number
  avg_latency_ms: number
  max_latency_ms: number
}

interface DriftAlert {
  id: string
  feature_name: string
  drift_method: string
  drift_score: number
  threshold: number
  sample_count: number
  status: string
  details: Record<string, unknown>
  detected_at: string
}

interface Snapshot {
  window_start: string
  total_requests: number
  error_count: number
  error_rate: number
  latency_avg: number
  latency_p95: number
  latency_p99: number
  top_errors: { msg: string; count: number }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number, decimals = 1) => n.toFixed(decimals)
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const riskColor = (rate: number) =>
  rate >= 0.1 ? 'text-red-400' : rate >= 0.02 ? 'text-yellow-400' : 'text-emerald-400'
const latencyColor = (ms: number) =>
  ms >= 2000 ? 'text-red-400' : ms >= 500 ? 'text-yellow-400' : 'text-emerald-400'

function StatCard({ icon, label, value, sub, color = 'text-white' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="text-gray-600">{icon}</div>
      </div>
      <div className={clsx('text-2xl font-bold mt-2', color)}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  )
}

function DriftBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    ks_test: 'bg-purple-900/50 text-purple-300 border-purple-700',
    z_score: 'bg-blue-900/50 text-blue-300 border-blue-700',
    psi: 'bg-orange-900/50 text-orange-300 border-orange-700',
  }
  return (
    <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-mono', colors[method] ?? 'bg-gray-800 text-gray-400 border-gray-700')}>
      {method.toUpperCase()}
    </span>
  )
}

// ── Expanded model row ────────────────────────────────────────────────────────

function ModelRow({ model }: { model: ModelSummary }) {
  const [expanded, setExpanded] = useState(false)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [alerts, setAlerts] = useState<DriftAlert[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [settingBaseline, setSettingBaseline] = useState(false)
  const [checkingDrift, setCheckingDrift] = useState(false)
  const [msg, setMsg] = useState('')

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true)
    try {
      const [snaps, alertResp] = await Promise.all([
        monitoringApi.getSnapshots(model.trainer_name, 24),
        monitoringApi.getDriftAlerts(model.trainer_name, 'open').catch(() => ({ alerts: [] })),
      ])
      setSnapshots(snaps.snapshots ?? [])
      setAlerts(alertResp.alerts ?? [])
    } catch {}
    finally { setLoadingDetail(false) }
  }, [model.trainer_name])

  const toggle = () => {
    if (!expanded) loadDetail()
    setExpanded(p => !p)
  }

  const handleSetBaseline = async () => {
    setSettingBaseline(true); setMsg('')
    try {
      const r = await monitoringApi.setBaseline(model.trainer_name)
      setMsg(`Baseline set from ${r.sample_count} samples (features: ${r.features?.join(', ') || 'none'})`)
    } catch (e: unknown) {
      setMsg('Failed: ' + (e as Error).message)
    }
    setSettingBaseline(false)
  }

  const handleCheckDrift = async () => {
    setCheckingDrift(true); setMsg('')
    try {
      const r = await monitoringApi.checkDrift(model.trainer_name)
      if (r.alerts_raised > 0) {
        setMsg(`⚠ ${r.alerts_raised} drift alert(s) raised`)
        setAlerts(prev => [...r.alerts, ...prev])
      } else {
        setMsg('✓ No drift detected')
      }
    } catch (e: unknown) {
      setMsg('Failed: ' + (e as Error).message)
    }
    setCheckingDrift(false)
  }

  const handleAcknowledge = async (alertId: string) => {
    await monitoringApi.updateAlert(alertId, 'acknowledged')
    setAlerts(prev => prev.filter(a => a.id !== alertId))
  }

  return (
    <>
      <tr className="border-b border-gray-800 hover:bg-gray-900/50 cursor-pointer" onClick={toggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronUp size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
            <span className="font-mono text-sm text-white">{model.trainer_name}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-gray-300">{model.total_requests.toLocaleString()}</td>
        <td className={clsx('px-4 py-3 text-sm font-mono', riskColor(model.error_rate))}>
          {pct(model.error_rate)}
        </td>
        <td className={clsx('px-4 py-3 text-sm font-mono', latencyColor(model.avg_latency_ms))}>
          {fmt(model.avg_latency_ms)}ms
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">{fmt(model.max_latency_ms)}ms</td>
      </tr>

      {expanded && (
        <tr className="bg-gray-900/30">
          <td colSpan={5} className="px-6 py-4">
            {loadingDetail ? (
              <div className="text-xs text-gray-500 py-2">Loading…</div>
            ) : (
              <div className="space-y-4">
                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={e => { e.stopPropagation(); handleSetBaseline() }}
                    disabled={settingBaseline}
                    className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 disabled:opacity-40 transition-colors">
                    {settingBaseline ? 'Setting…' : '📐 Set Drift Baseline'}
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleCheckDrift() }}
                    disabled={checkingDrift}
                    className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 disabled:opacity-40 transition-colors">
                    {checkingDrift ? 'Checking…' : '🔍 Check Drift Now'}
                  </button>
                  {msg && <span className="text-xs text-gray-400">{msg}</span>}
                </div>

                {/* Open drift alerts */}
                {alerts.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-yellow-400 mb-2">
                      ⚠ {alerts.length} open drift alert{alerts.length > 1 ? 's' : ''}
                    </div>
                    <div className="space-y-1.5">
                      {alerts.map(a => (
                        <div key={a.id} className="flex items-center justify-between bg-yellow-900/10 border border-yellow-800/30 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-3">
                            <DriftBadge method={a.drift_method} />
                            <span className="text-sm text-gray-200 font-mono">{a.feature_name}</span>
                            <span className="text-xs text-gray-400">
                              score <span className="text-yellow-300 font-mono">{a.drift_score.toFixed(3)}</span>
                              {' '}/ threshold <span className="font-mono">{a.threshold}</span>
                            </span>
                            <span className="text-xs text-gray-600">{new Date(a.detected_at).toLocaleString()}</span>
                          </div>
                          <button onClick={e => { e.stopPropagation(); handleAcknowledge(a.id) }}
                            className="text-[10px] px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">
                            Acknowledge
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hourly snapshots mini-table */}
                {snapshots.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-2">Last 24h hourly snapshots</div>
                    <div className="overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="text-gray-600 border-b border-gray-800">
                            <th className="text-left pb-1 font-normal">Window</th>
                            <th className="text-right pb-1 font-normal">Requests</th>
                            <th className="text-right pb-1 font-normal">Errors</th>
                            <th className="text-right pb-1 font-normal">Avg ms</th>
                            <th className="text-right pb-1 font-normal">p95 ms</th>
                            <th className="text-right pb-1 font-normal">p99 ms</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshots.slice(-12).map((s, i) => (
                            <tr key={i} className="border-b border-gray-800/50">
                              <td className="py-1 text-gray-500 font-mono">
                                {new Date(s.window_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-1 text-right text-gray-300">{s.total_requests}</td>
                              <td className={clsx('py-1 text-right font-mono', riskColor(s.error_rate))}>
                                {s.error_count > 0 ? `${s.error_count} (${pct(s.error_rate)})` : '—'}
                              </td>
                              <td className={clsx('py-1 text-right font-mono', latencyColor(s.latency_avg))}>
                                {fmt(s.latency_avg)}
                              </td>
                              <td className="py-1 text-right text-gray-400 font-mono">{fmt(s.latency_p95)}</td>
                              <td className="py-1 text-right text-gray-400 font-mono">{fmt(s.latency_p99)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {snapshots.length === 0 && alerts.length === 0 && (
                  <div className="text-xs text-gray-600">No snapshot data yet — snapshots are computed hourly.</div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MonitoringPage() {
  const [overview, setOverview] = useState<ModelSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [totalRequests, setTotalRequests] = useState(0)
  const [avgErrorRate, setAvgErrorRate] = useState(0)
  const [avgLatency, setAvgLatency] = useState(0)
  const [openAlerts, setOpenAlerts] = useState(0)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await monitoringApi.getOverview()
      const models: ModelSummary[] = data.models ?? []
      setOverview(models)

      const total = models.reduce((s, m) => s + m.total_requests, 0)
      const errors = models.reduce((s, m) => s + m.error_count, 0)
      const latencySum = models.reduce((s, m) => s + m.avg_latency_ms * m.total_requests, 0)
      setTotalRequests(total)
      setAvgErrorRate(total > 0 ? errors / total : 0)
      setAvgLatency(total > 0 ? latencySum / total : 0)

      // Count open drift alerts across all models
      const alertCounts = await Promise.allSettled(
        models.map(m => monitoringApi.getDriftAlerts(m.trainer_name, 'open').then(r => (r.alerts ?? []).length))
      )
      setOpenAlerts(alertCounts.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value : 0), 0))
    } catch {}
    finally { setRefreshing(false); setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Model Monitoring</h2>
          <p className="text-xs text-gray-500 mt-0.5">24-hour rolling window • hourly snapshots • drift detection</p>
        </div>
        <button onClick={load} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Activity size={16} />}
          label="Total requests (24h)"
          value={totalRequests.toLocaleString()}
          color="text-white"
        />
        <StatCard
          icon={<AlertTriangle size={16} />}
          label="Error rate (24h)"
          value={pct(avgErrorRate)}
          color={riskColor(avgErrorRate)}
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Avg latency (24h)"
          value={`${fmt(avgLatency)}ms`}
          color={latencyColor(avgLatency)}
        />
        <StatCard
          icon={<Zap size={16} />}
          label="Open drift alerts"
          value={String(openAlerts)}
          color={openAlerts > 0 ? 'text-yellow-400' : 'text-emerald-400'}
        />
      </div>

      {/* Models table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-gray-500" />
            <span className="text-sm font-medium text-white">Models</span>
            <span className="text-xs text-gray-600">({overview.length})</span>
          </div>
          <div className="text-xs text-gray-600">Click a row to see hourly breakdown + drift</div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-600">Loading…</div>
        ) : overview.length === 0 ? (
          <div className="p-8 text-center">
            <TrendingUp size={24} className="text-gray-700 mx-auto mb-2" />
            <div className="text-sm text-gray-500">No inference data in the last 24 hours</div>
            <div className="text-xs text-gray-600 mt-1">Run some inferences to populate this dashboard</div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-600 border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-2 font-semibold">Model</th>
                <th className="text-left px-4 py-2 font-semibold">Requests (24h)</th>
                <th className="text-left px-4 py-2 font-semibold">Error rate</th>
                <th className="text-left px-4 py-2 font-semibold">Avg latency</th>
                <th className="text-left px-4 py-2 font-semibold">Max latency</th>
              </tr>
            </thead>
            <tbody>
              {overview.map(m => <ModelRow key={m.trainer_name} model={m} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Info callout */}
      <div className="flex items-start gap-3 bg-blue-950/30 border border-blue-900/40 rounded-xl px-4 py-3">
        <CheckCircle size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-gray-400">
          <span className="text-blue-300 font-medium">Snapshots</span> are computed hourly by the scheduler.
          <span className="text-blue-300 font-medium ml-2">Drift baselines</span> must be set manually once a model has enough traffic.
          After setting a baseline, drift is checked every 6 hours automatically — or use the button above to check now.
        </div>
      </div>
    </div>
  )
}
