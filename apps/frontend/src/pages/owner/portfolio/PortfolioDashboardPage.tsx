import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'
import { listFrameworks, getFrameworkStats } from '@/api/frameworks'
import { propertiesApi } from '@/api/properties'
import { invoicesApi } from '@/api/invoices'
import { generalTicketsApi } from '@/api/tickets'
import type { FrameworkContract, FrameworkStats } from '@/types/framework'
import type { InvoiceCounts } from '@/types/invoice'
import type { TicketCounts } from '@/types/ticket'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `KES ${(n / 1_000).toFixed(0)}K`
  return `KES ${n.toLocaleString()}`
}

function pct(a: number, total: number): number {
  return total > 0 ? Math.round((a / total) * 100) : 0
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortfolioNode {
  id: string
  label: string
  icon: string
  type: 'root' | 'category' | 'asset'
  path?: string
  revenue: number
  expenses: number
  children?: PortfolioNode[]
  meta?: Record<string, string | number>
}

interface RiskItem {
  label: string
  detail: string
  severity: 'high' | 'medium' | 'low'
}

// ── Drill-down node ───────────────────────────────────────────────────────────

function DrillNode({ node, depth = 0 }: { node: PortfolioNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const navigate = useNavigate()
  const profit  = node.revenue - node.expenses
  const margin  = node.revenue > 0 ? Math.round((profit / node.revenue) * 100) : 0
  const hasChildren = node.children && node.children.length > 0
  const indent = depth * 16

  return (
    <div>
      <div
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition
          ${depth === 0 ? 'bg-gray-900 text-white' : depth === 1 ? 'bg-gray-100 hover:bg-gray-200' : 'hover:bg-gray-50'}`}
        style={{ marginLeft: indent }}
        onClick={() => hasChildren ? setOpen(v => !v) : node.path && navigate(node.path)}
      >
        <span className="text-xs w-4 shrink-0 text-gray-400">
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className="text-sm">{node.icon}</span>
        <span className={`flex-1 text-sm font-medium truncate ${depth === 0 ? 'text-white' : 'text-gray-800'}`}>
          {node.label}
        </span>
        <div className="flex items-center gap-6 text-xs shrink-0">
          <div className="text-right hidden sm:block">
            <div className={`font-semibold ${depth === 0 ? 'text-green-400' : 'text-gray-700'}`}>{fmt(node.revenue)}</div>
            <div className={`text-[10px] ${depth === 0 ? 'text-gray-500' : 'text-gray-400'}`}>Revenue</div>
          </div>
          <div className="text-right hidden sm:block">
            <div className={`font-semibold ${depth === 0 ? 'text-red-400' : 'text-gray-700'}`}>{fmt(node.expenses)}</div>
            <div className={`text-[10px] ${depth === 0 ? 'text-gray-500' : 'text-gray-400'}`}>Expenses</div>
          </div>
          <div className="text-right">
            <div className={`font-bold ${profit >= 0 ? (depth === 0 ? 'text-green-400' : 'text-green-600') : 'text-red-500'}`}>
              {fmt(profit)}
            </div>
            <div className={`text-[10px] ${depth === 0 ? 'text-gray-500' : 'text-gray-400'}`}>{margin}% margin</div>
          </div>
          {node.path && !hasChildren && (
            <button
              onClick={e => { e.stopPropagation(); navigate(node.path!) }}
              className="px-2.5 py-1 text-[10px] font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            >
              Open →
            </button>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <div className="mt-1 space-y-1">
          {node.children!.map(child => (
            <DrillNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cash flow bar ─────────────────────────────────────────────────────────────

function CashRow({ label, amount, target, warn }: {
  label: string; amount: number; target?: number; warn?: string
}) {
  const isOut = amount < 0
  const ratio = target ? Math.min(1, Math.abs(amount) / target) : 1
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-xs text-gray-600 shrink-0">{label}</div>
      <div className={`text-xs font-semibold w-28 shrink-0 ${isOut ? 'text-red-600' : 'text-gray-900'}`}>
        {isOut ? '-' : ''}{fmt(Math.abs(amount))}
      </div>
      {target && (
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isOut ? 'bg-red-400' : 'bg-blue-500'}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
      {target && (
        <div className="text-[10px] text-gray-400 w-8 text-right">{Math.round(ratio * 100)}%</div>
      )}
      {warn && <span className="text-[10px] text-orange-600 font-medium">{warn}</span>}
    </div>
  )
}

// ── Period config ─────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual'

const PERIODS: { key: Period; label: string; divisor: number }[] = [
  { key: 'daily',     label: 'Daily',     divisor: 365   },
  { key: 'weekly',    label: 'Weekly',    divisor: 52    },
  { key: 'monthly',   label: 'Monthly',   divisor: 12    },
  { key: 'quarterly', label: 'Quarterly', divisor: 4     },
  { key: 'biannual',  label: 'Biannual',  divisor: 2     },
  { key: 'annual',    label: 'Annual',    divisor: 1     },
]

function periodLabel(period: Period, now: Date): string {
  switch (period) {
    case 'daily':     return now.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'short' })
    case 'weekly':    return `Week of ${now.toLocaleDateString('default', { day: 'numeric', month: 'short' })}`
    case 'monthly':   return now.toLocaleString('default', { month: 'long', year: 'numeric' })
    case 'quarterly': return `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`
    case 'biannual':  return `H${now.getMonth() < 6 ? 1 : 2} ${now.getFullYear()}`
    case 'annual':    return `${now.getFullYear()}`
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioDashboardPage() {
  const [frameworks, setFrameworks]     = useState<FrameworkContract[]>([])
  const [fwStats, setFwStats]           = useState<Record<string, FrameworkStats>>({})
  const [propCount, setPropCount]       = useState(0)
  const [invoiceCounts, setInvoiceCounts] = useState<InvoiceCounts | null>(null)
  const [ticketCounts, setTicketCounts]   = useState<TicketCounts | null>(null)
  const [loading, setLoading]           = useState(true)
  const [period, setPeriod]             = useState<Period>('monthly')

  useEffect(() => {
    Promise.all([
      listFrameworks(),
      propertiesApi.list({ page_size: 100 } as any).catch(() => ({ items: [], total: 0 })),
      invoicesApi.getCounts().catch(() => null),
      generalTicketsApi.getCounts().catch(() => null),
    ]).then(async ([fws, props, invCounts, tkCounts]) => {
      setFrameworks(fws)
      setPropCount((props as any).total ?? 0)
      setInvoiceCounts(invCounts)
      setTicketCounts(tkCounts)
      const statsEntries = await Promise.all(
        fws.map(fw => getFrameworkStats(fw.id).then(s => [fw.id, s] as [string, FrameworkStats]))
      )
      setFwStats(Object.fromEntries(statsEntries))
    }).finally(() => setLoading(false))
  }, [])

  // ── Computed metrics ──────────────────────────────────────────────────────
  const divisor = PERIODS.find(p => p.key === period)!.divisor

  // Annual base figures
  const fwAnnualRevenue    = frameworks.reduce((sum, fw) =>
    sum + fw.schedule4_entries.reduce((s, e) => s + (e.cost_d || 0), 0), 0)
  const fwPenaltyExposure  = frameworks.reduce((sum, fw) => sum + (fwStats[fw.id]?.total_penalties_qtd || 0), 0)
  const fwOverdue          = frameworks.reduce((sum, fw) => sum + (fwStats[fw.id]?.overdue_schedules || 0), 0)
  const fwFaults           = frameworks.reduce((sum, fw) => sum + (fwStats[fw.id]?.fault || 0), 0)
  const fwOpenWO           = frameworks.reduce((sum, fw) => sum + (fwStats[fw.id]?.open_work_orders || 0), 0)

  const reAnnualRevenue    = propCount * 150_000 * 12
  const reAnnualExpenses   = reAnnualRevenue * 0.35

  const annualRevenue  = fwAnnualRevenue + reAnnualRevenue
  const annualExpenses = (fwAnnualRevenue * 0.40) + reAnnualExpenses

  // Period-scaled figures
  const fwRevenue     = fwAnnualRevenue / divisor
  const reRevenue     = reAnnualRevenue / divisor
  const reExpenses    = reAnnualExpenses / divisor
  const totalRevenue  = annualRevenue / divisor
  const totalExpenses = annualExpenses / divisor
  const totalProfit   = totalRevenue - totalExpenses

  const reShare = pct(reAnnualRevenue, annualRevenue)
  const fwShare = 100 - reShare

  // Cash flow for the period
  const periodNetRe = (reAnnualRevenue / divisor) * 0.78
  const periodNetFw = fwAnnualRevenue / divisor

  const risks: RiskItem[] = []

  // ── Real estate risks ──
  const overdueInvoices = invoiceCounts?.overdue ?? 0
  const openTickets     = (ticketCounts?.open ?? 0) + (ticketCounts?.assigned ?? 0)
  const inProgressTickets = ticketCounts?.in_progress ?? 0

  if (overdueInvoices > 0)
    risks.push({
      label: `${overdueInvoices} overdue invoice${overdueInvoices > 1 ? 's' : ''}`,
      detail: 'Rent arrears — tenants past due date',
      severity: overdueInvoices > 5 ? 'high' : 'medium',
    })
  if (openTickets > 0)
    risks.push({
      label: `${openTickets} open maintenance ticket${openTickets > 1 ? 's' : ''}`,
      detail: `${inProgressTickets} in progress — unresolved tenant issues`,
      severity: openTickets > 10 ? 'high' : 'medium',
    })

  // ── Framework risks ──
  if (fwOverdue > 0)
    risks.push({ label: `${fwOverdue} overdue PPM visit${fwOverdue > 1 ? 's' : ''}`, detail: 'SLA breach likely → penalty risk', severity: 'high' })
  if (fwFaults > 0)
    risks.push({ label: `${fwFaults} asset${fwFaults > 1 ? 's' : ''} in fault state`, detail: 'Emergency callout SLA clock running', severity: 'high' })
  if (fwPenaltyExposure > 0)
    risks.push({ label: 'SLA penalties accrued', detail: `${fmt(fwPenaltyExposure)} exposure this quarter`, severity: 'medium' })
  const expiringFw = frameworks.filter(fw => {
    const diff = (new Date(fw.contract_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff > 0 && diff < 90
  })
  if (expiringFw.length > 0)
    risks.push({ label: `${expiringFw.length} contract${expiringFw.length > 1 ? 's' : ''} expiring in 90 days`, detail: expiringFw.map(fw => fw.name).join(', '), severity: 'medium' })

  // Sort: high → medium → low
  const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
  risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  // Drill-down tree
  const fwChildren: PortfolioNode[] = frameworks.map(fw => {
    const annualRev = fw.schedule4_entries.reduce((s, e) => s + (e.cost_d || 0), 0)
    const rev       = annualRev / divisor
    const stats     = fwStats[fw.id]
    return {
      id: fw.id,
      label: fw.name,
      icon: '⚡',
      type: 'asset' as const,
      path: `/portfolio/frameworks/${fw.id}`,
      revenue: rev,
      expenses: rev * 0.40,
      meta: { sites: fw.schedule4_entries.length, assets: stats?.total_assets || 0, overdue: stats?.overdue_schedules || 0 },
      children: fw.schedule4_entries.map(e => ({
        id: e.id,
        label: `${e.site_code ? e.site_code + ' — ' : ''}${e.site_name}`,
        icon: '📍',
        type: 'asset' as const,
        revenue: (e.cost_d || 0) / divisor,
        expenses: ((e.cost_d || 0) / divisor) * 0.40,
        meta: { region: e.region, kva: e.kva_rating || '—' },
      })),
    }
  })

  const tree: PortfolioNode = {
    id: 'root',
    label: 'Total Portfolio',
    icon: '🏦',
    type: 'root',
    revenue: totalRevenue,
    expenses: totalExpenses,
    children: [
      {
        id: 'real_estate',
        label: 'Real Estate',
        icon: '🏢',
        type: 'category',
        path: '/portfolio/properties',
        revenue: reRevenue,
        expenses: reExpenses,
        children: propCount > 0 ? [{
          id: 're_placeholder',
          label: `${propCount} propert${propCount > 1 ? 'ies' : 'y'} — open workspace for detail`,
          icon: '🏘️',
          type: 'asset',
          path: '/portfolio/properties',
          revenue: reRevenue,
          expenses: reExpenses,
        }] : [],
      },
      {
        id: 'frameworks',
        label: 'Framework Asset Management',
        icon: '⚡',
        type: 'category',
        path: '/portfolio/frameworks',
        revenue: fwRevenue,
        expenses: fwRevenue * 0.40,
        children: fwChildren,
      },
    ],
  }

  const now = new Date()

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Portfolio Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Unified view across all asset classes</p>
          </div>
          {/* Period filter */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 shrink-0 flex-wrap">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
                  period === p.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400 text-sm">Loading portfolio data…</div>
        ) : (
          <>
            {/* ── KPI banner ─────────────────────────────────────────────── */}
            <div className="bg-gray-900 text-white rounded-2xl overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">PORTFOLIO OVERVIEW</span>
                <span className="text-xs text-gray-500">{periodLabel(period, now)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-800">
                {[
                  { label: `${PERIODS.find(p => p.key === period)!.label} Revenue`,  value: fmt(totalRevenue),                           sub: 'all portfolios' },
                  { label: `${PERIODS.find(p => p.key === period)!.label} Expenses`, value: fmt(totalExpenses),                          sub: 'est. delivery cost' },
                  { label: 'Net Profit',                                              value: fmt(totalProfit),                            sub: `${pct(totalProfit, totalRevenue)}% margin`, highlight: true },
                  { label: 'At Risk',                                                 value: fmt(fwPenaltyExposure + fwFaults * 50_000), sub: 'penalties + faults' },
                ].map(k => (
                  <div key={k.label} className="px-5 py-4">
                    <div className={`text-lg font-bold ${k.highlight ? 'text-green-400' : 'text-white'}`}>{k.value}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{k.label}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">{k.sub}</div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-gray-800">
                <div className="flex items-center gap-3 text-xs mb-1.5">
                  <span className="text-gray-400">Real Estate</span>
                  <span className="font-semibold text-blue-400">{reShare}%</span>
                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${reShare}%` }} />
                  </div>
                  <span className="font-semibold text-amber-400">{fwShare}%</span>
                  <span className="text-gray-400">Framework</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span>🏢 {propCount} propert{propCount !== 1 ? 'ies' : 'y'}</span>
                  <span>⚡ {frameworks.length} contract{frameworks.length !== 1 ? 's' : ''}</span>
                  <span>📍 {frameworks.reduce((s, fw) => s + fw.schedule4_entries.length, 0)} sites</span>
                </div>
              </div>
            </div>

            {/* ── Cash flow + risks ───────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-4">
                  Cash Flow — {periodLabel(period, now)}
                </h2>
                <div className="space-y-3">
                  <CashRow label="Rent collected"    amount={periodNetRe}              target={reRevenue} />
                  <CashRow label="Contract payments" amount={periodNetFw}              target={fwRevenue} />
                  <CashRow label="Maintenance out"   amount={-(totalExpenses * 0.6)} />
                  {fwPenaltyExposure > 0 &&
                    <CashRow label="SLA penalties" amount={-(fwPenaltyExposure / divisor)} warn={`⚠ ${fwOpenWO} open WOs`} />
                  }
                  <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">NET</span>
                    <span className="text-sm font-bold text-gray-900">
                      = {fmt(periodNetRe + periodNetFw - totalExpenses)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-4">Upcoming Risks (90 days)</h2>
                {risks.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">No active risks detected</div>
                ) : (
                  <div className="space-y-3">
                    {risks.map((r, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0
                          ${r.severity === 'high' ? 'bg-red-500' : r.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                        <div>
                          <div className="text-xs font-semibold text-gray-800">{r.label}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{r.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Overdue Rent',  value: overdueInvoices, bad: overdueInvoices > 0 },
                    { label: 'Open Tickets',  value: openTickets,     bad: openTickets > 5     },
                    { label: 'Overdue PPM',   value: fwOverdue,       bad: fwOverdue > 0       },
                    { label: 'Fault Assets',  value: fwFaults,        bad: fwFaults > 0        },
                    { label: 'Open WOs',      value: fwOpenWO,        bad: false               },
                    { label: 'Expiring Ctr.', value: expiringFw.length, bad: expiringFw.length > 0 },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <div className={`text-lg font-bold ${s.bad && s.value > 0 ? 'text-red-600' : 'text-gray-700'}`}>{s.value}</div>
                      <div className="text-[10px] text-gray-400">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Drill-down P&L ──────────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Revenue · Expenses · Profit</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Click any row to expand. Click Open → to enter the workspace.</p>
                </div>
                <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-1 rounded-lg">
                  {PERIODS.find(p => p.key === period)!.label} estimates
                </span>
              </div>
              <div className="p-4 space-y-1.5">
                <DrillNode node={tree} depth={0} />
              </div>
              <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-[10px] text-gray-400">
                  ⓘ {PERIODS.find(p => p.key === period)!.label} estimates — revenue and expenses scaled from annual base figures.
                  Framework revenue from Schedule 4 entries, real estate from unit rent estimates.
                  Full ledger-based P&amp;L available after financial integration.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
