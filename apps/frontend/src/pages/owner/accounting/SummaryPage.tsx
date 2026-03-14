import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { accountingApi } from '@/api/accounting'
import { extractApiError } from '@/utils/apiError'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import type { AccountingSummary, TenantBehavior, TenantBehaviorList, VacancyLive, VacantUnitDetail } from '@/types/accounting'

function MetricCard({ label, value, sub, color }: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function fmt(n: number) {
  return `KSh ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export default function SummaryPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [billingMonth, setBillingMonth] = useState('')  // empty = all-time
  const [summary, setSummary] = useState<AccountingSummary | null>(null)

  // Tenant behavior — paginated
  const [tenantMeta, setTenantMeta] = useState<Omit<TenantBehaviorList, 'items'> | null>(null)
  const [tenants, setTenants] = useState<TenantBehavior[]>([])
  const [tenantCursor, setTenantCursor] = useState<string | null>(null)
  const [tenantSort, setTenantSort] = useState<'outstanding' | 'reliability'>('outstanding')
  const [tenantLoadingMore, setTenantLoadingMore] = useState(false)

  // Vacancy — paginated
  const [vacancyMeta, setVacancyMeta] = useState<Omit<VacancyLive, 'items'> | null>(null)
  const [vacancyItems, setVacancyItems] = useState<VacantUnitDetail[]>([])
  const [vacancyCursor, setVacancyCursor] = useState<string | null>(null)
  const [vacancyLoading, setVacancyLoading] = useState(false)
  const [vacancyLoadingMore, setVacancyLoadingMore] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadSummary() {
    setLoading(true)
    setError(null)
    try {
      const [s, t] = await Promise.all([
        accountingApi.getSummary(billingMonth, propertyId),
        accountingApi.getTenantBehavior({ sortBy: tenantSort }),
      ])
      setSummary(s)
      const { items: tItems, ...tMeta } = t
      setTenantMeta(tMeta)
      setTenants(tItems)
      setTenantCursor(t.next_cursor ?? null)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadMoreTenants() {
    if (!tenantCursor) return
    setTenantLoadingMore(true)
    try {
      const t = await accountingApi.getTenantBehavior({ cursor: tenantCursor, sortBy: tenantSort })
      setTenants(prev => [...prev, ...t.items])
      setTenantCursor(t.next_cursor ?? null)
      setTenantMeta({ total: t.total, next_cursor: t.next_cursor ?? null, has_more: t.has_more })
    } catch {
      // keep existing items
    } finally {
      setTenantLoadingMore(false)
    }
  }

  async function loadVacancy() {
    setVacancyLoading(true)
    try {
      const v = await accountingApi.getVacancyLive({ propertyId: propertyId })
      const { items, next_cursor, has_more, ...meta } = v
      setVacancyMeta({ ...meta, next_cursor, has_more })
      setVacancyItems(items ?? [])
      setVacancyCursor(next_cursor ?? null)
    } catch {
      setVacancyMeta(null)
      setVacancyItems([])
    } finally {
      setVacancyLoading(false)
    }
  }

  async function loadMoreVacancy() {
    if (!vacancyCursor) return
    setVacancyLoadingMore(true)
    try {
      const v = await accountingApi.getVacancyLive({ propertyId: propertyId, cursor: vacancyCursor })
      setVacancyItems(prev => [...prev, ...(v.items ?? [])])
      setVacancyCursor(v.next_cursor)
      setVacancyMeta(prev => prev ? { ...prev, has_more: v.has_more, next_cursor: v.next_cursor } : prev)
    } catch {
      // keep existing items
    } finally {
      setVacancyLoadingMore(false)
    }
  }

  useEffect(() => { loadSummary() }, [billingMonth, tenantSort])
  useEffect(() => { loadVacancy() }, [propertyId])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
        {propertyId && <PropertyBreadcrumb page="Summary" />}
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Accounting Summary</h1>
            <p className="text-sm text-gray-500 mt-1">
              {billingMonth
                ? `Showing data for ${billingMonth}`
                : propertyId ? 'Financial overview for this property — all time' : 'Financial overview and tenant analytics — all time'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Month</label>
            <input
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {billingMonth && (
              <button
                onClick={() => setBillingMonth('')}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                title="Show all months"
              >
                All time ✕
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {/* Financial metric cards */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Invoiced" value={fmt(summary.total_invoiced)} />
            <MetricCard
              label="Total Collected"
              value={fmt(summary.total_collected)}
              color="text-green-600"
            />
            <MetricCard
              label="Outstanding"
              value={fmt(summary.total_outstanding)}
              color={summary.total_outstanding > 0 ? 'text-red-600' : 'text-green-600'}
            />
            <MetricCard
              label="Collection Rate"
              value={pct(summary.collection_rate)}
              color={summary.collection_rate >= 0.9 ? 'text-green-600' : summary.collection_rate >= 0.7 ? 'text-amber-600' : 'text-red-600'}
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* By-property revenue — only shown in org-wide view */}
        {!propertyId && summary && summary.by_property.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Revenue by Property</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500 uppercase">Property</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Invoiced</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Collected</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.by_property.map((p) => (
                    <tr key={p.property_id}>
                      <td className="px-5 py-3 font-medium text-gray-900">{p.property_name}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{p.invoiced.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right text-green-600 font-medium">{p.collected.toLocaleString()}</td>
                      <td className={`px-5 py-3 text-right font-medium ${p.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {p.outstanding.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">
                        {p.invoiced > 0 ? pct(p.collected / p.invoiced) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tenant payment behavior */}
        {(tenants.length > 0 || tenantMeta) && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-700">Tenant Payment Behavior</h2>
                {tenantMeta && (
                  <span className="text-xs text-gray-400">
                    {tenants.length} of {tenantMeta.total}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTenantSort('outstanding')}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${tenantSort === 'outstanding' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  By Outstanding
                </button>
                <button
                  onClick={() => setTenantSort('reliability')}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${tenantSort === 'reliability' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  By Reliability
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500 uppercase">Tenant</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">On-time Rate</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Avg Delay</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Reliability</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500 uppercase">Invoices</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tenants.map((t) => (
                    <tr key={t.tenant_id}>
                      <td className="px-5 py-3 font-medium text-gray-900">{t.tenant_name}</td>
                      <td className={`px-5 py-3 text-right font-medium ${t.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {t.outstanding_balance > 0 ? fmt(t.outstanding_balance) : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          t.on_time_rate >= 0.9 ? 'bg-green-100 text-green-700' :
                          t.on_time_rate >= 0.7 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {pct(t.on_time_rate)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {t.avg_payment_delay_days > 0 ? `${t.avg_payment_delay_days}d` : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-16 bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${t.reliability_score >= 0.8 ? 'bg-green-500' : t.reliability_score >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${t.reliability_score * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8">{pct(t.reliability_score)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">{t.total_invoices}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tenantMeta?.has_more && (
              <div className="px-5 py-3 border-t border-gray-100 flex justify-center">
                <button
                  onClick={loadMoreTenants}
                  disabled={tenantLoadingMore}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {tenantLoadingMore && <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin inline-block" />}
                  {tenantLoadingMore ? 'Loading…' : `Load more (${tenantMeta.total - tenants.length} remaining)`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Vacancy Report */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Vacancy — Live Snapshot</h2>
            <span className="text-xs text-gray-400">Current unit &amp; lease state</span>
          </div>

          {vacancyLoading && (
            <div className="px-5 py-6 flex justify-center">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {vacancyMeta && !vacancyLoading && (
            <div>
              <div className="px-5 py-4 grid grid-cols-4 gap-4 border-b border-gray-100">
                <div>
                  <p className="text-xs text-gray-500">Total Units</p>
                  <p className="text-xl font-bold text-gray-900">{vacancyMeta.total_units}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Occupied</p>
                  <p className="text-xl font-bold text-green-600">{vacancyMeta.occupied_units}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vacant</p>
                  <p className="text-xl font-bold text-red-600">{vacancyMeta.vacant_units}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vacancy Rate</p>
                  <p className="text-xl font-bold text-amber-600">{pct(vacancyMeta.vacancy_rate)}</p>
                </div>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-gray-500 mb-3">
                  Estimated Lost Rent (all vacant units): <strong className="text-red-600">{fmt(vacancyMeta.estimated_lost_rent)}</strong>
                </p>
                {vacancyItems.length > 0 && (
                  <>
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {!propertyId && <th className="text-left px-3 py-2 text-gray-500">Property</th>}
                          <th className="text-left px-3 py-2 text-gray-500">Unit</th>
                          <th className="text-right px-3 py-2 text-gray-500">Days Vacant</th>
                          <th className="text-right px-3 py-2 text-gray-500">Est. Lost Rent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {vacancyItems.map((d) => (
                          <tr key={d.unit_id}>
                            {!propertyId && <td className="px-3 py-2 text-gray-700">{d.property_name}</td>}
                            <td className="px-3 py-2 font-mono text-gray-700">{d.unit_label}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{d.days_vacant}</td>
                            <td className="px-3 py-2 text-right text-red-600">
                              {d.estimated_lost_rent ? fmt(d.estimated_lost_rent) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {vacancyMeta.has_more && (
                      <div className="pt-3 flex justify-center">
                        <button
                          onClick={loadMoreVacancy}
                          disabled={vacancyLoadingMore}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 flex items-center gap-2"
                        >
                          {vacancyLoadingMore && <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin inline-block" />}
                          {vacancyLoadingMore ? 'Loading…' : `Load more (${vacancyMeta.vacant_units - vacancyItems.length} remaining)`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
  )
}
