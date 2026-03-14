import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import { dashboardApi } from '@/api/dashboard'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import DashboardLayout from '@/layouts/DashboardLayout'
import type { Property } from '@/types/property'
import type { DashboardData, CollectionTrendEntry } from '@/types/dashboard'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtCurrency(n: number) {
  return `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleString('default', { month: 'short' })
}
function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank',
  mpesa_stk: 'M-Pesa',
  mpesa_b2c: 'M-Pesa',
  manual: 'Manual',
}

const TICKET_STATUS_COLOR: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  pending_review: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red' | 'blue' | 'amber'
}) {
  const accentCls =
    accent === 'green'
      ? 'border-t-2 border-t-green-500'
      : accent === 'red'
        ? 'border-t-2 border-t-red-500'
        : accent === 'amber'
          ? 'border-t-2 border-t-amber-500'
          : accent === 'blue'
            ? 'border-t-2 border-t-blue-500'
            : ''
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 ${accentCls}`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function AlertChip({
  count,
  label,
  to,
  color,
}: {
  count: number
  label: string
  to: string
  color: 'red' | 'amber' | 'blue' | 'orange'
}) {
  if (count === 0) return null
  const cls =
    color === 'red'
      ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
      : color === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
        : color === 'orange'
          ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
          : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${cls}`}
    >
      <span className="font-bold">{count}</span>
      <span>{label}</span>
      <span className="ml-auto opacity-60">→</span>
    </Link>
  )
}

function TrendBar({ entry, max }: { entry: CollectionTrendEntry; max: number }) {
  const invoicedH = max > 0 ? (entry.invoiced / max) * 80 : 0
  const collectedH = max > 0 ? (entry.collected / max) * 80 : 0
  const isCurrentMonth = entry.month === new Date().toISOString().slice(0, 7)

  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <div className="w-full flex items-end gap-0.5 h-20">
        {/* Invoiced bar */}
        <div
          className="flex-1 rounded-t bg-blue-100"
          style={{ height: `${invoicedH}px` }}
          title={`Invoiced: ${fmtCurrency(entry.invoiced)}`}
        />
        {/* Collected bar */}
        <div
          className="flex-1 rounded-t bg-blue-500"
          style={{ height: `${collectedH}px` }}
          title={`Collected: ${fmtCurrency(entry.collected)}`}
        />
      </div>
      <span className={`text-xs ${isCurrentMonth ? 'font-bold text-blue-700' : 'text-gray-400'}`}>
        {fmtMonth(entry.month)}
      </span>
      {entry.rate !== null && (
        <span className="text-xs font-medium text-gray-500">{entry.rate}%</span>
      )}
    </div>
  )
}

function CollectionTrendChart({ trend }: { trend: CollectionTrendEntry[] }) {
  const max = Math.max(...trend.map((e) => Math.max(e.invoiced, e.collected)), 1)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 text-sm">Collection Trend</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-100 inline-block" />
            Invoiced
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
            Collected
          </span>
        </div>
      </div>
      <div className="flex items-end gap-2 mt-2">
        {trend.map((e) => (
          <TrendBar key={e.month} entry={e} max={max} />
        ))}
      </div>
    </div>
  )
}

function RecentActivity({
  payments,
  tickets,
}: {
  payments: DashboardData['recent_payments']
  tickets: DashboardData['recent_tickets']
}) {
  const [tab, setTab] = useState<'payments' | 'tickets'>('payments')
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 text-sm">Recent Activity</h3>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          <button
            onClick={() => setTab('payments')}
            className={`px-3 py-1.5 font-medium transition-colors ${tab === 'payments' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Payments
          </button>
          <button
            onClick={() => setTab('tickets')}
            className={`px-3 py-1.5 font-medium transition-colors ${tab === 'tickets' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Tickets
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'payments' && (
          <div className="divide-y divide-gray-50">
            {payments.length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">No recent payments</p>
            )}
            {payments.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.tenant_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {METHOD_LABEL[p.method] ?? p.method} · {p.payment_date}
                  </p>
                </div>
                <span className="text-sm font-semibold text-green-700">{fmtCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'tickets' && (
          <div className="divide-y divide-gray-50">
            {tickets.length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">No recent tickets</p>
            )}
            {tickets.map((t) => (
              <div key={t.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{relativeTime(t.created_at)}</p>
                </div>
                <span
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${TICKET_STATUS_COLOR[t.status] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {t.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OwnerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [properties, setProperties] = useState<Property[]>([])
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      propertiesApi.list({ page_size: 50 }).then((r) => r.items),
      dashboardApi.get(),
    ])
      .then(([props, dash]) => {
        setProperties(props)
        setData(dash)
      })
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [])

  const displayName = user?.email?.split('@')[0] ?? 'there'
  const hasAlerts =
    data &&
    (data.alerts.open_tickets > 0 ||
      data.alerts.overdue_invoices > 0 ||
      data.alerts.leases_expiring_30d > 0 ||
      data.alerts.pending_meter_readings > 0)

  return (
    <DashboardLayout>
      <div className="p-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome back, {displayName}</h1>
            <p className="text-sm text-gray-500 mt-1">Here's your portfolio at a glance.</p>
          </div>
          <Link
            to="/portfolio/properties/new"
            className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            + Add Property
          </Link>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Occupancy Rate"
            value={loading || !data ? '—' : `${data.occupancy.occupancy_rate}%`}
            sub={
              data
                ? `${fmt(data.occupancy.occupied)} of ${fmt(data.occupancy.total_units)} units`
                : undefined
            }
            accent={
              data
                ? data.occupancy.occupancy_rate >= 80
                  ? 'green'
                  : data.occupancy.occupancy_rate >= 60
                    ? 'amber'
                    : 'red'
                : undefined
            }
          />
          <KpiCard
            label="Outstanding Balance"
            value={loading || !data ? '—' : fmtCurrency(data.financial.outstanding_balance)}
            sub={
              data
                ? `${fmtCurrency(data.financial.this_month_invoiced)} invoiced this month`
                : undefined
            }
            accent={data && data.financial.outstanding_balance > 0 ? 'amber' : 'green'}
          />
          <KpiCard
            label="Collection Rate (30d)"
            value={
              loading || !data
                ? '—'
                : data.financial.collection_rate_30d !== null
                  ? `${data.financial.collection_rate_30d}%`
                  : 'N/A'
            }
            sub={
              data
                ? `${fmtCurrency(data.financial.this_month_collected)} collected this month`
                : undefined
            }
            accent={
              data && data.financial.collection_rate_30d !== null
                ? data.financial.collection_rate_30d >= 80
                  ? 'green'
                  : data.financial.collection_rate_30d >= 60
                    ? 'amber'
                    : 'red'
                : undefined
            }
          />
          <KpiCard
            label="Open Tickets"
            value={loading || !data ? '—' : fmt(data.alerts.open_tickets)}
            sub={
              data
                ? `${fmt(properties.length)} propert${properties.length === 1 ? 'y' : 'ies'}`
                : undefined
            }
            accent={
              data ? (data.alerts.open_tickets > 0 ? 'blue' : 'green') : undefined
            }
          />
        </div>

        {/* Alert Strip */}
        {!loading && data && hasAlerts && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-400 self-center font-medium mr-1">Action needed:</span>
            <AlertChip
              count={data.alerts.overdue_invoices}
              label="overdue invoices"
              to="/owner/accounting/invoices"
              color="red"
            />
            <AlertChip
              count={data.alerts.leases_expiring_30d}
              label="leases expiring in 30d"
              to="/owner/properties"
              color="amber"
            />
            <AlertChip
              count={data.alerts.pending_meter_readings}
              label="pending meter readings"
              to="/owner/tickets"
              color="orange"
            />
            <AlertChip
              count={data.alerts.open_tickets}
              label="open tickets"
              to="/owner/tickets"
              color="blue"
            />
          </div>
        )}

        {/* Trend + Recent Activity */}
        {!loading && data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <CollectionTrendChart trend={data.collection_trend} />
            <RecentActivity payments={data.recent_payments} tickets={data.recent_tickets} />
          </div>
        )}

        {/* Properties Table */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Properties</h2>
            {properties.length > 0 && (
              <Link to="/portfolio/properties" className="text-sm text-blue-600 hover:underline font-medium">
                View all →
              </Link>
            )}
          </div>

          {loading && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading…</div>
          )}

          {!loading && properties.length === 0 && (
            <div className="px-6 py-16 text-center">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🏢</span>
              </div>
              <p className="text-gray-600 font-medium mb-1">No properties yet</p>
              <p className="text-sm text-gray-400 mb-5">
                Create your first property to start managing units and leases.
              </p>
              <Link
                to="/portfolio/properties/new"
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 inline-block"
              >
                Create Property
              </Link>
            </div>
          )}

          {!loading && properties.length > 0 && (
            <div className="divide-y divide-gray-50">
              {properties.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {p.address.city} · {p.unit_count} units · {p.property_type}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => navigate(`/portfolio/properties/${p.id}/reports/rent-roll`)}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-medium transition-colors"
                    >
                      Reports
                    </button>
                    <Link
                      to={`/portfolio/properties/${p.id}/leases`}
                      className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium transition-colors"
                    >
                      Leases
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add property shortcut */}
        {!loading && properties.length > 0 && (
          <Link
            to="/portfolio/properties/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Add another property
          </Link>
        )}
      </div>
    </DashboardLayout>
  )
}
