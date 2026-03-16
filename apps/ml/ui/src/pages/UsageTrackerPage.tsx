import React, { useEffect, useState } from 'react'
import { RefreshCw, Search, Users, Cpu, Cloud, Zap, Database, Timer } from 'lucide-react'
import { adminApi, type UserUsageRow, type UsageResponse } from '@/api/admin'
import { useAuth } from '@/context/AuthContext'
import clsx from 'clsx'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtHrs(h: number) {
  if (h < 0.001) return '0 hrs'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)} hrs`
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtBytes(b: number) {
  if (b === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log2(b) / 10), units.length - 1)
  const val = b / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : val.toFixed(0)} ${units[i]}`
}

// ─── Progress bar ──────────────────────────────────────────────────────────

function Bar({ pct, warn = 80 }: { pct: number; warn?: number }) {
  const clamped = Math.min(pct, 100)
  const color = clamped >= 100 ? 'bg-red-500' : clamped >= warn ? 'bg-amber-500' : 'bg-brand-500'
  return (
    <div className="h-1 w-full rounded-full bg-gray-800 overflow-hidden">
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${clamped}%` }} />
    </div>
  )
}

// ─── Metric cell ───────────────────────────────────────────────────────────

function MetricCell({
  used, limit, pct, unit = '', resetAt,
}: { used: number | string; limit: number | string; pct: number; unit?: string; resetAt?: string | null }) {
  const noLimit = !limit || limit === 0
  return (
    <div className="space-y-1 min-w-[110px]">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-medium text-white">
          {typeof used === 'number' ? used.toLocaleString() : used}{unit}
        </span>
        <span className="text-[10px] text-gray-600">
          {noLimit ? '∞' : `/ ${typeof limit === 'number' ? limit.toLocaleString() : limit}${unit}`}
        </span>
      </div>
      {!noLimit && <Bar pct={pct} />}
      {noLimit && <div className="h-1 w-full rounded-full bg-gray-800" />}
      {resetAt && (
        <div className="text-[10px] text-gray-600">resets {fmtDate(resetAt)}</div>
      )}
    </div>
  )
}

// ─── Role badge ────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    admin: 'bg-red-900/60 border-red-700/40 text-red-300',
    engineer: 'bg-blue-900/60 border-blue-700/40 text-blue-300',
    viewer: 'bg-gray-800 border-gray-700 text-gray-400',
  }
  return (
    <span className={clsx('text-[9px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider',
      map[role] ?? map.viewer)}>
      {role}
    </span>
  )
}

// ─── Admin table ───────────────────────────────────────────────────────────

function AdminUsageTable({ data, loading, onRefresh }: {
  data: UsageResponse | null
  loading: boolean
  onRefresh: () => void
}) {
  const [q, setQ] = useState('')
  const rows = (data?.users ?? []).filter(u =>
    !q || u.email.toLowerCase().includes(q.toLowerCase()) ||
    (u.full_name && u.full_name.toLowerCase().includes(q.toLowerCase()))
  )

  const totalInfMonth = rows.reduce((s, r) => s + (r.inference.month_total ?? 0), 0)
  const totalInfCost = rows.reduce((s, r) => s + (r.inference.month_cost_usd ?? 0), 0)
  const usersOnPlan = rows.filter(r => r.plan_name).length

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <Users size={14} />, label: 'Total users', val: data?.total ?? '—' },
          { icon: <Cpu size={14} />, label: 'On a plan', val: usersOnPlan },
          { icon: <Zap size={14} />, label: 'Inferences this month', val: totalInfMonth.toLocaleString() },
          { icon: <Database size={14} />, label: 'Inference cost (month)', val: `$${totalInfCost.toFixed(4)}` },
        ].map(c => (
          <div key={c.label} className="flex items-center gap-2.5 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <span className="text-brand-400 flex-shrink-0">{c.icon}</span>
            <div>
              <div className="text-sm font-semibold text-white">{c.val}</div>
              <div className="text-[10px] text-gray-500">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by email or name…"
            className="w-full pl-8 pr-3 py-2 text-xs bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-brand-600"
          />
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-lg hover:text-white disabled:opacity-40 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-800">
              {['User', 'Plan', 'CPU + Std GPU', 'Accel. GPU Credit', 'Inference Quota', 'Inferences (month)', 'Inf. Cost', 'Latency (avg/p95)', 'Last Called', 'Storage', 'Reset'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] text-gray-500 uppercase tracking-wider font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-600">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-600">No users found.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.email} className={clsx('border-b border-gray-800/60', i % 2 === 0 ? '' : 'bg-gray-900/40')}>
                {/* User */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="font-medium text-white truncate max-w-[160px]">{r.email}</div>
                  {r.full_name && <div className="text-[10px] text-gray-500 truncate">{r.full_name}</div>}
                  <RoleBadge role={r.role} />
                </td>

                {/* Plan */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.plan_name
                    ? <span className="text-brand-300 font-medium">{r.plan_name}</span>
                    : <span className="text-gray-600 italic">No plan</span>}
                </td>

                {/* CPU + Local GPU */}
                <td className="px-4 py-3">
                  <MetricCell
                    used={fmtHrs(r.local_compute.used_hours)}
                    limit={r.local_compute.limit_hours > 0 ? fmtHrs(r.local_compute.limit_hours) : 0}
                    pct={r.local_compute.pct}
                    resetAt={r.local_compute.reset_at}
                  />
                </td>

                {/* Cloud GPU */}
                <td className="px-4 py-3">
                  <MetricCell
                    used={`$${r.cloud_gpu.used_usd.toFixed(2)}`}
                    limit={r.cloud_gpu.limit_usd > 0 ? `$${r.cloud_gpu.limit_usd.toFixed(2)}` : 0}
                    pct={r.cloud_gpu.pct}
                    resetAt={r.cloud_gpu.reset_at}
                  />
                </td>

                {/* Inference quota */}
                <td className="px-4 py-3">
                  <MetricCell
                    used={r.inference.quota_used}
                    limit={r.inference.quota_limit}
                    pct={r.inference.quota_pct}
                    resetAt={r.inference.reset_at}
                  />
                </td>

                {/* Cumulative inferences this month */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Zap size={11} className="text-amber-400 flex-shrink-0" />
                    <span className="font-medium text-white">{(r.inference.month_total ?? 0).toLocaleString()}</span>
                  </div>
                </td>

                {/* Inference cost this month */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={clsx('font-medium', (r.inference.month_cost_usd ?? 0) > 0 ? 'text-amber-300' : 'text-gray-600')}>
                    ${(r.inference.month_cost_usd ?? 0).toFixed(4)}
                  </span>
                </td>

                {/* Latency */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.inference.avg_latency_ms != null ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <Timer size={11} className="text-sky-400 flex-shrink-0" />
                        <span className="text-white font-medium">{fmtMs(r.inference.avg_latency_ms)}</span>
                        <span className="text-gray-600 text-[10px]">avg</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        p95 {fmtMs(r.inference.p95_latency_ms)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>

                {/* Last called */}
                <td className="px-4 py-3 whitespace-nowrap text-[11px] text-gray-500">
                  {r.inference.last_called_at ? fmtDate(r.inference.last_called_at) : '—'}
                </td>

                {/* Storage */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <Database size={11} className="text-blue-400 flex-shrink-0" />
                      <span className="text-white font-medium">{r.storage.model_count}</span>
                      <span className="text-gray-600">models</span>
                    </div>
                    {(r.storage.dataset_count ?? 0) > 0 && (
                      <div className="flex items-center gap-1">
                        <Database size={11} className="text-teal-400 flex-shrink-0" />
                        <span className="text-white font-medium">{(r.storage.dataset_count ?? 0).toLocaleString()}</span>
                        <span className="text-gray-600">datasets</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="text-white font-medium">{fmtBytes(r.storage.storage_bytes ?? 0)}</span>
                    </div>
                  </div>
                </td>

                {/* Next reset */}
                <td className="px-4 py-3 whitespace-nowrap text-[11px] text-gray-500">
                  {fmtDate(r.local_compute.reset_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Self-service view (non-admin) ─────────────────────────────────────────

type MetricItem = {
  icon: React.ReactNode
  label: string
  used: string
  limit: string
  pct: number
  resetAt: string | null | undefined
  extra?: string | null
  lastCalled?: string | null
}

function MyUsageView({ data, loading }: { data: (UserUsageRow & { month_start: string }) | null; loading: boolean }) {
  if (loading) return <div className="py-20 text-center text-gray-600 text-sm">Loading your usage…</div>
  if (!data) return <div className="py-20 text-center text-gray-600 text-sm">Could not load usage data.</div>

  const metrics: MetricItem[] = [
    {
      icon: <Cpu size={16} className="text-blue-400" />,
      label: 'CPU + Local GPU',
      used: fmtHrs(data.local_compute.used_hours),
      limit: data.local_compute.limit_hours > 0 ? fmtHrs(data.local_compute.limit_hours) : '∞',
      pct: data.local_compute.pct,
      resetAt: data.local_compute.reset_at,
    },
    {
      icon: <Cloud size={16} className="text-purple-400" />,
      label: 'Cloud GPU Credit',
      used: `$${data.cloud_gpu.used_usd.toFixed(2)}`,
      limit: data.cloud_gpu.limit_usd > 0 ? `$${data.cloud_gpu.limit_usd.toFixed(2)}` : '∞',
      pct: data.cloud_gpu.pct,
      resetAt: data.cloud_gpu.reset_at,
    },
    {
      icon: <Zap size={16} className="text-amber-400" />,
      label: 'Inference Quota',
      used: data.inference.quota_used.toLocaleString(),
      limit: data.inference.quota_limit > 0 ? data.inference.quota_limit.toLocaleString() : '∞',
      pct: data.inference.quota_pct,
      resetAt: data.inference.reset_at,
      extra: `${(data.inference.month_total ?? 0).toLocaleString()} calls · $${(data.inference.month_cost_usd ?? 0).toFixed(4)} · avg ${fmtMs(data.inference.avg_latency_ms)} · p95 ${fmtMs(data.inference.p95_latency_ms)}`,
      lastCalled: data.inference.last_called_at,
    },
    {
      icon: <Database size={16} className="text-green-400" />,
      label: 'Storage',
      used: fmtBytes(data.storage.storage_bytes ?? 0),
      limit: '∞',
      pct: 0,
      resetAt: null,
      extra: (data.storage.dataset_count ?? 0) > 0
        ? `${data.storage.model_count} models · ${data.storage.dataset_count.toLocaleString()} datasets`
        : `${data.storage.model_count} models`,
    },
  ]

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="text-sm text-gray-400">
        Plan: <span className="text-white font-medium">{data.plan_name ?? 'No plan assigned'}</span>
        <span className="ml-4 text-gray-600 text-xs">Month starts {fmtDate(data.month_start)}</span>
      </div>
      {metrics.map(m => (
        <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {m.icon}
              <span className="text-sm font-medium text-white">{m.label}</span>
            </div>
            <span className="text-xs text-gray-500">
              {m.used} <span className="text-gray-700">/ {m.limit}</span>
            </span>
          </div>
          <Bar pct={m.pct} />
          <div className="flex items-center justify-between text-[11px]">
            <span className={clsx('font-medium', m.pct >= 100 ? 'text-red-400' : m.pct >= 80 ? 'text-amber-400' : 'text-gray-500')}>
              {m.pct.toFixed(1)}% used
            </span>
            <div className="text-right space-y-0.5">
              {m.extra && <div className="text-amber-300/80">{m.extra}</div>}
              {m.lastCalled && <div className="text-gray-600">last called {fmtDate(m.lastCalled)}</div>}
              {m.resetAt && <div className="text-gray-600">resets {fmtDate(m.resetAt)}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function UsageTrackerPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [adminData, setAdminData] = useState<UsageResponse | null>(null)
  const [myData, setMyData] = useState<(UserUsageRow & { month_start: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAdmin = async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await adminApi.getUsage()
      setAdminData(d)
    } catch {
      setError('Failed to load usage data.')
    } finally {
      setLoading(false)
    }
  }

  const fetchMe = async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await adminApi.getMyUsage()
      setMyData(d)
    } catch {
      setError('Failed to load usage data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) fetchAdmin()
    else fetchMe()
  }, [isAdmin])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white">Usage Tracker</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {isAdmin
            ? 'Compute, inference, and storage usage per user — resets align with each user\'s plan period.'
            : 'Your compute, inference, and storage usage for the current plan period.'}
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {isAdmin
        ? <AdminUsageTable data={adminData} loading={loading} onRefresh={fetchAdmin} />
        : <MyUsageView data={myData} loading={loading} />}
    </div>
  )
}
