import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import type { TrainerViolation, MLClient } from '../types/trainerSubmission'
import {
  Users, Brain, Cpu, ShieldAlert, RefreshCw, AlertTriangle,
  CheckCircle2, Search, ChevronRight, X, Activity,
  Calendar, Clock,
} from 'lucide-react'
import clsx from 'clsx'

// ── Design-system helpers (mirrors AdminAnalyticsPage) ─────────────────────────

type Accent = 'blue' | 'green' | 'amber' | 'red' | 'brand' | 'purple'

const ACCENT_MAP: Record<Accent, string> = {
  blue:   'text-blue-400 bg-blue-900/20 border-blue-800/30',
  green:  'text-emerald-400 bg-emerald-900/20 border-emerald-800/30',
  amber:  'text-amber-400 bg-amber-900/20 border-amber-800/30',
  red:    'text-red-400 bg-red-900/20 border-red-800/30',
  brand:  'text-brand-400 bg-brand-900/20 border-brand-800/30',
  purple: 'text-violet-400 bg-violet-900/20 border-violet-800/30',
}

function StatCard({
  icon, label, value, sub, accent = 'brand',
}: { icon: React.ReactNode; label: string; value: string | number; sub?: string; accent?: Accent }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={clsx('w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0', ACCENT_MAP[accent])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">{label}</div>
        <div className="text-xl font-bold text-white leading-none">{value}</div>
        {sub && <div className="text-[11px] text-gray-600 mt-1">{sub}</div>}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-bold text-gray-600 uppercase tracking-widest mb-3">{children}</h2>
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400 truncate max-w-[160px]">{label}</span>
        <span className="text-gray-300 font-medium ml-2 flex-shrink-0">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Severity badge ──────────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<string, string> = {
  low:       'bg-yellow-900/30 text-yellow-400 border border-yellow-800/40',
  high:      'bg-orange-900/30 text-orange-400 border border-orange-800/40',
  critical:  'bg-red-900/30 text-red-400 border border-red-800/40',
  malicious: 'bg-red-950 text-red-300 border border-red-700',
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={clsx('text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize', SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.low)}>
      {severity}
    </span>
  )
}

// ── Date preset ─────────────────────────────────────────────────────────────────

type Preset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: '24h',    label: '24h' },
  { id: '7d',     label: '7d' },
  { id: '30d',    label: '30d' },
  { id: '90d',    label: '90d' },
  { id: 'all',    label: 'All' },
  { id: 'custom', label: 'Custom' },
]

function presetRange(p: Preset): { from: string; to: string } | null {
  if (p === 'all' || p === 'custom') return null
  const now = new Date()
  const from = new Date(now)
  if (p === '24h') from.setHours(now.getHours() - 24)
  else if (p === '7d') from.setDate(now.getDate() - 7)
  else if (p === '30d') from.setDate(now.getDate() - 30)
  else if (p === '90d') from.setDate(now.getDate() - 90)
  return { from: from.toISOString(), to: now.toISOString() }
}

// ── Client detail slide-over ────────────────────────────────────────────────────

function ClientSlideOver({ client, violations, onClose }: {
  client: MLClient
  violations: TrainerViolation[]
  onClose: () => void
}) {
  const clientViolations = violations.filter(v => v.org_id === client.org_id)

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/50 backdrop-blur-sm" />
      <div
        className="w-[420px] bg-gray-950 border-l border-gray-800 h-full flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <div className="text-sm font-bold text-white">Client Detail</div>
            <div className="text-[11px] text-gray-500 font-mono mt-0.5">{client.org_id}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Overview metrics */}
          <div>
            <SectionTitle>Overview</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Users',       value: client.user_count,       accent: 'brand' as Accent,  icon: <Users size={14} /> },
                { label: 'Trainers',    value: client.trainer_count,    accent: 'blue' as Accent,   icon: <Brain size={14} /> },
                { label: 'Deployments', value: client.deployment_count, accent: 'green' as Accent,  icon: <Cpu size={14} /> },
                { label: 'Violations',  value: client.violation_count,
                  accent: client.violation_count > 0 ? 'red' as Accent : 'green' as Accent,
                  icon: <ShieldAlert size={14} /> },
              ].map(item => (
                <StatCard key={item.label} icon={item.icon} label={item.label} value={item.value} accent={item.accent} />
              ))}
            </div>
          </div>

          {/* Plan */}
          {client.plan_name && (
            <div>
              <SectionTitle>Plan</SectionTitle>
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-white font-medium">{client.plan_name}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-900/30 text-brand-400 border border-brand-800/40">Active</span>
              </div>
            </div>
          )}

          {/* Last active */}
          {client.last_active && (
            <div>
              <SectionTitle>Activity</SectionTitle>
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-gray-400">
                <Clock size={13} />
                Last active: <span className="text-gray-300">{new Date(client.last_active).toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Violations */}
          <div>
            <SectionTitle>Violations ({clientViolations.length})</SectionTitle>
            {clientViolations.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-8 text-center">
                <CheckCircle2 size={20} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-xs text-gray-500">No violations recorded</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clientViolations.map(v => (
                  <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityBadge severity={v.severity} />
                      <span className="text-xs font-medium text-gray-300">{v.trainer_name}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">{v.summary}</p>
                    <p className="text-[10px] text-gray-600">{new Date(v.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────

type Tab = 'clients' | 'issues'

export default function ClientsPage() {
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<MLClient[]>([])
  const [violations, setViolations] = useState<TrainerViolation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<MLClient | null>(null)

  // Date filter state
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let from: string | undefined
      let to: string | undefined
      if (preset === 'custom') {
        from = customFrom ? new Date(customFrom).toISOString() : undefined
        to   = customTo   ? new Date(customTo).toISOString()   : undefined
      } else {
        const range = presetRange(preset)
        from = range?.from
        to   = range?.to
      }
      const params: Record<string, string> = {}
      if (from) params.from = from
      if (to)   params.to   = to

      const [clientsRes, violationsRes] = await Promise.all([
        api.get('/clients', { params }),
        api.get('/clients/violations/all', { params }),
      ])
      setClients(clientsRes.data.items ?? [])
      setViolations(violationsRes.data.items ?? [])
    } catch {
      setError('Failed to load client data')
    } finally {
      setLoading(false)
    }
  }, [preset, customFrom, customTo])

  useEffect(() => {
    if (preset !== 'custom') fetchData()
  }, [preset, fetchData])

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const totalUsers       = clients.reduce((s, c) => s + c.user_count, 0)
  const totalTrainers    = clients.reduce((s, c) => s + c.trainer_count, 0)
  const totalDeployments = clients.reduce((s, c) => s + c.deployment_count, 0)
  const totalViolations  = violations.length
  const activeClients    = clients.filter(c => c.last_active).length
  const maxViolations    = Math.max(...clients.map(c => c.violation_count), 1)

  // ── Filtered rows ─────────────────────────────────────────────────────────────
  const filteredClients = search
    ? clients.filter(c =>
        c.org_id.toLowerCase().includes(search.toLowerCase()) ||
        (c.org_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.plan_name ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : clients

  const filteredViolations = search
    ? violations.filter(v =>
        v.org_id.toLowerCase().includes(search.toLowerCase()) ||
        v.trainer_name.toLowerCase().includes(search.toLowerCase()) ||
        v.owner_email.toLowerCase().includes(search.toLowerCase())
      )
    : violations

  return (
    <div className="space-y-6 max-w-6xl p-6">

      {/* ── Header + date filter ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Clients</h1>
          <p className="text-xs text-gray-500 mt-0.5">All platform organisations and security issues</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset pills */}
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-xl p-1 gap-0.5">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => setPreset(p.id)}
                className={clsx(
                  'px-3 py-1 text-xs rounded-lg transition-colors',
                  preset === p.id ? 'bg-brand-600 text-white font-semibold' : 'text-gray-500 hover:text-gray-200'
                )}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500" />
              <span className="text-gray-600 text-xs">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500" />
              <button onClick={fetchData}
                className="px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium transition-colors">
                Apply
              </button>
            </div>
          )}

          <button onClick={fetchData} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ── Summary stat cards ── */}
      {loading && !clients.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <section>
            <SectionTitle>Summary</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard icon={<Users size={15} />}       label="Orgs"        value={clients.length}   accent="brand" />
              <StatCard icon={<Activity size={15} />}    label="Active"      value={activeClients}    sub={`of ${clients.length}`} accent="green" />
              <StatCard icon={<Users size={15} />}       label="Total Users" value={totalUsers}        accent="blue" />
              <StatCard icon={<Brain size={15} />}       label="Trainers"    value={totalTrainers}     accent="purple" />
              <StatCard icon={<Cpu size={15} />}         label="Deployments" value={totalDeployments}  accent="amber" />
              <StatCard icon={<ShieldAlert size={15} />} label="Violations"  value={totalViolations}
                accent={totalViolations > 0 ? 'red' : 'green'}
                sub={totalViolations > 0 ? 'need review' : 'all clear'} />
            </div>
          </section>

          {/* Violation breakdown mini-bars */}
          {clients.some(c => c.violation_count > 0) && (
            <section>
              <SectionTitle>Violations by Org</SectionTitle>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                {clients
                  .filter(c => c.violation_count > 0)
                  .sort((a, b) => b.violation_count - a.violation_count)
                  .slice(0, 8)
                  .map(c => (
                    <MiniBar
                      key={c.org_id}
                      label={c.org_name || c.org_id}
                      value={c.violation_count}
                      max={maxViolations}
                      color="bg-red-500"
                    />
                  ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-0.5 border-b border-gray-800">
        {([
          { id: 'clients' as Tab, label: `Clients (${clients.length})`,  icon: <Users size={13} /> },
          { id: 'issues'  as Tab, label: `Issues (${violations.length})`, icon: <ShieldAlert size={13} /> },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300'
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'clients' ? 'Search org, plan…' : 'Search org, trainer, email…'}
          className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-8 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-600"
        />
      </div>

      {/* ── Clients table ── */}
      {tab === 'clients' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-600 text-sm">Loading clients…</div>
          ) : filteredClients.length === 0 ? (
            <div className="p-12 text-center">
              <Users size={32} className="mx-auto text-gray-700 mb-3" />
              <p className="text-gray-500 text-sm font-medium">
                {search ? 'No clients match your search' : 'No clients yet'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Organisation', 'Users', 'Trainers', 'Deployments', 'Violations', 'Plan', 'Last Active', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {filteredClients.map(c => (
                  <tr key={c.org_id}
                    className="hover:bg-gray-800/30 transition-colors group cursor-pointer"
                    onClick={() => setSelectedClient(c)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 flex-shrink-0">
                          {(c.org_name || c.org_id)[0].toUpperCase()}
                        </div>
                        <div>
                          {c.org_name && <div className="font-medium text-white text-sm">{c.org_name}</div>}
                          <div className={clsx('font-mono text-gray-500', c.org_name ? 'text-[10px]' : 'text-sm text-gray-300')}>
                            {c.org_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-300">{c.user_count}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-300">{c.trainer_count}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-300">{c.deployment_count}</td>
                    <td className="px-5 py-3.5">
                      {c.violation_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-800/40">
                          <ShieldAlert size={10} /> {c.violation_count}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-900/20 text-emerald-500 border border-emerald-800/20">
                          <CheckCircle2 size={10} /> 0
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.plan_name ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-900/30 text-brand-400 border border-brand-800/40">
                          {c.plan_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500">
                      {c.last_active
                        ? new Date(c.last_active).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                        : <span className="text-gray-700">Never</span>}
                    </td>
                    <td className="pr-4 py-3.5">
                      <ChevronRight size={14} className="text-gray-700 group-hover:text-gray-400 transition-colors" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Issues list ── */}
      {tab === 'issues' && (
        <div className="space-y-2">
          {loading ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center text-gray-600 text-sm">Loading…</div>
          ) : filteredViolations.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-3" />
              <p className="text-gray-400 text-sm font-medium">
                {search ? 'No issues match your search' : 'No security issues recorded'}
              </p>
              <p className="text-gray-600 text-xs mt-1">All submitted trainers have passed security review.</p>
            </div>
          ) : filteredViolations.map(v => (
            <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <SeverityBadge severity={v.severity} />
                    <span className="text-sm font-semibold text-white">{v.trainer_name}</span>
                    <span className="text-[11px] text-gray-500 font-mono">org: {v.org_id}</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{v.summary}</p>
                  {v.issues.length > 0 && (
                    <div className="border-l-2 border-red-800/50 pl-3 space-y-0.5 mb-2">
                      {v.issues.slice(0, 3).map((issue, i) => (
                        <p key={i} className="text-[11px] text-red-400">• {issue}</p>
                      ))}
                      {v.issues.length > 3 && (
                        <p className="text-[11px] text-gray-600">+{v.issues.length - 3} more</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-gray-600">
                    <span className="flex items-center gap-1"><Users size={10} /> {v.owner_email}</span>
                    <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(v.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <span className={clsx(
                  'flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full',
                  v.resolved
                    ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'
                    : 'bg-amber-900/30 text-amber-400 border border-amber-800/40'
                )}>
                  {v.resolved ? 'resolved' : 'open'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Client detail slide-over ── */}
      {selectedClient && (
        <ClientSlideOver
          client={selectedClient}
          violations={violations}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  )
}
