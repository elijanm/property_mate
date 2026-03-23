import { useState, useEffect, useCallback } from 'react'
import { securityApi } from '../api/security'
import {
  Shield, AlertTriangle, Ban, CheckCircle, RefreshCw,
  Eye, Trash2, Search, Filter, Lock, Unlock
} from 'lucide-react'
import clsx from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IPSummary {
  ip: string
  threat_score: number
  is_banned: boolean
  ban_reason: string
  total_requests: number
  upload_attempts: number
  blocked_uploads: number
  suspicious_path_hits: number
  first_seen: string
  last_seen: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  threat_reasons: string[]
}

interface DashboardData {
  ip_counts: { total: number; banned: number; critical: number; high: number }
  requests: {
    last_1h: number; blocked_1h: number; block_rate_1h: number
    uploads_1h: number; blocked_uploads_1h: number; last_24h: number
  }
  top_suspicious: IPSummary[]
  recent_blocks: {
    ip: string; method: string; path: string; status_code: number
    blocked: boolean; block_reason?: string; timestamp: string; is_upload: boolean; latency_ms?: number
  }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  low: 'text-emerald-400 bg-emerald-900/30 border-emerald-800',
  medium: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  high: 'text-orange-400 bg-orange-900/30 border-orange-800',
  critical: 'text-red-400 bg-red-900/30 border-red-800',
}

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide', RISK_COLORS[level] ?? RISK_COLORS.low)}>
      {level}
    </span>
  )
}

function ThreatBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.85 ? 'bg-red-500' : score >= 0.6 ? 'bg-orange-500' : score >= 0.35 ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-400">{(score * 100).toFixed(0)}%</span>
    </div>
  )
}

function StatCard({ icon, label, value, sub, color = 'text-white' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-gray-600 mb-2">{icon}</div>
      <div className={clsx('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  )
}

// ── Admin password modal ──────────────────────────────────────────────────────

function AdminModal({
  title, onConfirm, onClose
}: {
  title: string
  onConfirm: (password: string) => Promise<void>
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!password) { setError('Password required'); return }
    setLoading(true); setError('')
    try {
      await onConfirm(password)
      onClose()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? (e as Error).message
      setError(msg || 'Action failed')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} className="text-yellow-400" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
        {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 px-3 py-2 text-xs text-white bg-brand-600 hover:bg-brand-500 rounded-lg transition-colors disabled:opacity-40">
            {loading ? 'Processing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── IP row ────────────────────────────────────────────────────────────────────

function IPRow({
  record, onRefresh
}: {
  record: IPSummary
  onRefresh: () => void
}) {
  const [modal, setModal] = useState<'ban' | 'ban-confirm' | 'unban' | 'delete' | null>(null)
  const [banReason, setBanReason] = useState('')

  const handleUnban = async (pw: string) => {
    await securityApi.unbanIp(record.ip, pw)
    onRefresh()
  }
  const handleBan = async (pw: string) => {
    await securityApi.banIp(record.ip, banReason || 'Manually banned', null, pw)
    onRefresh()
  }
  const handleDelete = async (pw: string) => {
    await securityApi.deleteIp(record.ip, pw)
    onRefresh()
  }

  return (
    <>
      <tr className="border-b border-gray-800 hover:bg-gray-900/40">
        <td className="px-4 py-3 font-mono text-sm text-white">{record.ip}</td>
        <td className="px-4 py-3"><ThreatBar score={record.threat_score} /></td>
        <td className="px-4 py-3"><RiskBadge level={record.risk_level} /></td>
        <td className="px-4 py-3 text-sm text-gray-400">{record.total_requests.toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-gray-500">{new Date(record.last_seen).toLocaleString()}</td>
        <td className="px-4 py-3">
          {record.is_banned ? (
            <span className="text-[10px] px-2 py-0.5 bg-red-900/40 border border-red-800 text-red-400 rounded-full font-semibold">
              BANNED
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-500 rounded-full">
              active
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {record.is_banned ? (
              <button onClick={() => setModal('unban')}
                title="Unban"
                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-900/30 transition-colors">
                <Unlock size={13} />
              </button>
            ) : (
              <button onClick={() => setModal('ban')}
                title="Ban"
                className="p-1.5 rounded-lg text-red-500 hover:bg-red-900/30 transition-colors">
                <Ban size={13} />
              </button>
            )}
            <button onClick={() => setModal('delete')}
              title="Delete record (GDPR erasure)"
              className="p-1.5 rounded-lg text-gray-600 hover:text-red-500 hover:bg-red-900/20 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>

      {/* Ban reason input inline before confirming */}
      {modal === 'ban' && (
        <tr className="bg-gray-900/60 border-b border-gray-800">
          <td colSpan={7} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Ban reason (optional)…"
                value={banReason}
                onChange={e => setBanReason(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none"
              />
              <button onClick={() => setModal('ban-confirm')}
                className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">
                Continue
              </button>
              <button onClick={() => setModal(null)}
                className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}

      {modal === 'ban-confirm' && (
        <AdminModal title={`Ban ${record.ip}`} onConfirm={handleBan} onClose={() => setModal(null)} />
      )}
      {modal === 'unban' && (
        <AdminModal title={`Unban ${record.ip}`} onConfirm={handleUnban} onClose={() => setModal(null)} />
      )}
      {modal === 'delete' && (
        <AdminModal title={`Delete all data for ${record.ip}`} onConfirm={handleDelete} onClose={() => setModal(null)} />
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [ips, setIps] = useState<IPSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'overview' | 'ips' | 'logs'>('overview')
  const [search, setSearch] = useState('')
  const [bannedOnly, setBannedOnly] = useState(false)
  const [minThreat, setMinThreat] = useState(0)
  const [logs, setLogs] = useState<DashboardData['recent_blocks']>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [blockedOnly, setBlockedOnly] = useState(false)

  const loadDashboard = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await securityApi.getDashboard()
      setDashboard(data)
    } catch {}
    finally { setRefreshing(false); setLoading(false) }
  }, [])

  const loadIps = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await securityApi.listIps({
        banned_only: bannedOnly,
        min_threat: minThreat,
        limit: 200,
      })
      setIps(data.items ?? [])
    } catch {}
    finally { setRefreshing(false) }
  }, [bannedOnly, minThreat])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const data = await securityApi.getLogs({ blocked_only: blockedOnly, limit: 100 })
      setLogs(data.items ?? [])
    } catch {}
    finally { setLogsLoading(false) }
  }, [blockedOnly])

  useEffect(() => { loadDashboard() }, [loadDashboard])
  useEffect(() => { if (tab === 'ips') loadIps() }, [tab, loadIps])
  useEffect(() => { if (tab === 'logs') loadLogs() }, [tab, loadLogs])

  const refresh = () => {
    if (tab === 'overview') loadDashboard()
    else if (tab === 'ips') loadIps()
    else loadLogs()
  }

  const filteredIps = ips.filter(r =>
    !search || r.ip.includes(search)
  )

  const d = dashboard

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Security Overview</h2>
          <p className="text-xs text-gray-500 mt-0.5">IP threat detection • ban management • request logs</p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {(['overview', 'ips', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('px-4 py-1.5 text-xs rounded-lg font-medium transition-colors capitalize',
              tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}>
            {t === 'ips' ? 'IP Records' : t === 'logs' ? 'Request Logs' : 'Overview'}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {loading ? (
            <div className="text-sm text-gray-600 py-8 text-center">Loading…</div>
          ) : d ? (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={<Shield size={16} />} label="Total IPs tracked" value={d.ip_counts.total} />
                <StatCard icon={<Ban size={16} />} label="Banned IPs" value={d.ip_counts.banned}
                  color={d.ip_counts.banned > 0 ? 'text-red-400' : 'text-emerald-400'} />
                <StatCard icon={<AlertTriangle size={16} />} label="Critical threats (unbanned)"
                  value={d.ip_counts.critical}
                  color={d.ip_counts.critical > 0 ? 'text-red-400' : 'text-emerald-400'} />
                <StatCard icon={<CheckCircle size={16} />} label="Block rate (1h)"
                  value={`${(d.requests.block_rate_1h * 100).toFixed(1)}%`}
                  sub={`${d.requests.blocked_1h} blocked / ${d.requests.last_1h} total`}
                  color={d.requests.block_rate_1h > 0.05 ? 'text-red-400' : 'text-emerald-400'} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard icon={<Eye size={16} />} label="Requests last 1h" value={d.requests.last_1h.toLocaleString()} />
                <StatCard icon={<Eye size={16} />} label="Requests last 24h" value={d.requests.last_24h.toLocaleString()} />
                <StatCard icon={<AlertTriangle size={16} />} label="Blocked uploads (1h)"
                  value={d.requests.blocked_uploads_1h}
                  sub={`${d.requests.uploads_1h} total uploads`}
                  color={d.requests.blocked_uploads_1h > 0 ? 'text-red-400' : 'text-emerald-400'} />
              </div>

              {/* Top suspicious IPs */}
              {d.top_suspicious.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                    <AlertTriangle size={14} className="text-yellow-500" />
                    <span className="text-sm font-medium text-white">Top suspicious IPs (unbanned)</span>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs text-gray-600 border-b border-gray-800">
                        <th className="text-left px-4 py-2 font-semibold">IP</th>
                        <th className="text-left px-4 py-2 font-semibold">Threat</th>
                        <th className="text-left px-4 py-2 font-semibold">Risk</th>
                        <th className="text-left px-4 py-2 font-semibold">Requests</th>
                        <th className="text-left px-4 py-2 font-semibold">Reasons</th>
                        <th className="text-left px-4 py-2 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.top_suspicious.map(r => (
                        <IPRow key={r.ip} record={r} onRefresh={loadDashboard} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent blocks */}
              {d.recent_blocks.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                    <Ban size={14} className="text-red-500" />
                    <span className="text-sm font-medium text-white">Recent blocked requests</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {d.recent_blocks.slice(0, 10).map((log, i) => (
                      <div key={i} className="flex items-center gap-4 px-4 py-2.5 text-xs">
                        <span className="font-mono text-gray-400 w-32 flex-shrink-0">{log.ip}</span>
                        <span className="text-gray-600 w-12 flex-shrink-0">{log.method}</span>
                        <span className="font-mono text-gray-400 flex-1 truncate">{log.path}</span>
                        <span className="text-red-400 w-32 truncate flex-shrink-0">{log.block_reason ?? '—'}</span>
                        <span className="text-gray-600 flex-shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-600 text-center py-8">Failed to load dashboard</div>
          )}
        </div>
      )}

      {/* ── IP RECORDS TAB ── */}
      {tab === 'ips' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                type="text"
                placeholder="Filter by IP…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 w-48"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={bannedOnly} onChange={e => setBannedOnly(e.target.checked)}
                className="rounded bg-gray-800 border-gray-600" />
              Banned only
            </label>
            <div className="flex items-center gap-1.5">
              <Filter size={11} className="text-gray-600" />
              <span className="text-xs text-gray-600">Min threat:</span>
              {[0, 0.35, 0.6, 0.85].map(v => (
                <button key={v} onClick={() => setMinThreat(v)}
                  className={clsx('text-[10px] px-2 py-0.5 rounded border transition-colors', minThreat === v
                    ? 'bg-brand-600/30 border-brand-700 text-brand-300'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600')}>
                  {v > 0 ? `≥${(v * 100).toFixed(0)}%` : 'All'}
                </button>
              ))}
            </div>
            <button onClick={loadIps} className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 transition-colors">
              Apply
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-800 text-xs text-gray-600">
              {filteredIps.length} IPs{bannedOnly ? ' (banned only)' : ''}
            </div>
            {refreshing ? (
              <div className="p-8 text-center text-sm text-gray-600">Loading…</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-600 border-b border-gray-800 bg-gray-900/50">
                    <th className="text-left px-4 py-2 font-semibold">IP</th>
                    <th className="text-left px-4 py-2 font-semibold">Threat score</th>
                    <th className="text-left px-4 py-2 font-semibold">Risk</th>
                    <th className="text-left px-4 py-2 font-semibold">Requests</th>
                    <th className="text-left px-4 py-2 font-semibold">Last seen</th>
                    <th className="text-left px-4 py-2 font-semibold">Status</th>
                    <th className="text-left px-4 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIps.map(r => (
                    <IPRow key={r.ip} record={r} onRefresh={loadIps} />
                  ))}
                  {filteredIps.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-600">No IPs found</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── REQUEST LOGS TAB ── */}
      {tab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={blockedOnly} onChange={e => setBlockedOnly(e.target.checked)}
                className="rounded bg-gray-800 border-gray-600" />
              Blocked only
            </label>
            <button onClick={loadLogs} className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 transition-colors">
              Apply
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {logsLoading ? (
              <div className="p-8 text-center text-sm text-gray-600">Loading…</div>
            ) : (
              <div className="divide-y divide-gray-800">
                <div className="grid grid-cols-[130px_56px_1fr_100px_80px_100px] gap-2 px-4 py-2 text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                  <span>IP</span><span>Method</span><span>Path</span><span>Status</span><span>Latency</span><span>Time</span>
                </div>
                {logs.map((log: {
                  ip: string; method: string; path: string; status_code: number;
                  latency_ms?: number; timestamp: string; blocked: boolean; block_reason?: string
                }, i) => (
                  <div key={i} className={clsx('grid grid-cols-[130px_56px_1fr_100px_80px_100px] gap-2 px-4 py-2 text-xs items-center',
                    log.blocked ? 'bg-red-950/20' : 'hover:bg-gray-800/30')}>
                    <span className="font-mono text-gray-300 truncate">{log.ip}</span>
                    <span className={clsx('font-mono text-[10px]',
                      log.method === 'POST' ? 'text-blue-400' : log.method === 'DELETE' ? 'text-red-400' : 'text-gray-400')}>
                      {log.method}
                    </span>
                    <span className="font-mono text-gray-400 truncate" title={log.path}>{log.path}</span>
                    <span className={clsx('font-mono text-[10px]',
                      log.status_code >= 500 ? 'text-red-400' :
                      log.status_code >= 400 ? 'text-yellow-400' : 'text-emerald-400')}>
                      {log.status_code}
                      {log.blocked && <span className="ml-1 text-red-500">• {log.block_reason?.slice(0, 20)}</span>}
                    </span>
                    <span className="font-mono text-gray-500 text-[10px]">
                      {log.latency_ms != null ? `${log.latency_ms.toFixed(0)}ms` : '—'}
                    </span>
                    <span className="text-gray-600 text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-gray-600">No logs found</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
