import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { leasesApi } from '@/api/leases'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { tenantsApi } from '@/api/tenants'
import { paymentsApi } from '@/api/payments'
import { extractApiError } from '@/utils/apiError'
import TenantSlideOver from '@/components/TenantSlideOver'
import ApplyDiscountModal from '@/components/ApplyDiscountModal'
import BulkMessageSlideOver from '@/components/BulkMessageSlideOver'
import { computeBehaviourScore } from '@/utils/behaviourScore'
import { useMfaSession } from '@/hooks/useMfaSession'
import { maskEmail, maskPhone } from '@/utils/maskPii'
import MfaPinModal from '@/components/MfaPinModal'
import type { Lease } from '@/types/lease'
import type { Tenant } from '@/types/tenant'
import type { PaymentSummary } from '@/types/payment'

// ── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.round(diff / 86_400_000)
}

function expiryLabel(days: number | null): { text: string; cls: string } {
  if (days === null) return { text: 'Rolling', cls: 'text-gray-400' }
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, cls: 'text-red-600 font-medium' }
  if (days === 0) return { text: 'Expires today', cls: 'text-red-600 font-semibold' }
  if (days === 1) return { text: 'Expires tomorrow', cls: 'text-orange-600 font-medium' }
  if (days <= 14) return { text: `${days} days left`, cls: 'text-orange-500 font-medium' }
  if (days <= 60) return { text: `${days} days left`, cls: 'text-yellow-600' }
  return { text: `${days} days left`, cls: 'text-green-600' }
}

// Arrears = sum of unpaid invoice balances; computed server-side
function calcRentArrears(_lease: Lease, summary: PaymentSummary): number {
  return summary.outstanding_balance ?? 0
}

// Credit = direct deposit overpayment; computed server-side
function calcCredit(_lease: Lease, summary: PaymentSummary): number {
  return summary.prepayment_credit ?? 0
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

// ── Row data ───────────────────────────────────────────────────────────────

interface TenantRow {
  lease: Lease
  tenant: Tenant | null
  summary: PaymentSummary | null
}

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-700',
  active:     'bg-green-100 text-green-800',
  expired:    'bg-orange-100 text-orange-700',
  terminated: 'bg-red-100 text-red-700',
}

// ── Component ─────────────────────────────────────────────────────────────

export default function PropertyTenantsPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { isUnlocked, unlock } = useMfaSession()
  const [showMfa, setShowMfa] = useState(false)
  const [rows, setRows] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'rent' | 'arrears' | 'expiry'>('name')
  const [selectedRow, setSelectedRow] = useState<TenantRow | null>(null)
  const [menuOpenLeaseId, setMenuOpenLeaseId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [discountLease, setDiscountLease] = useState<Lease | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showBulkMessage, setShowBulkMessage] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenLeaseId(null)
        setMenuPos(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function loadRows() {
    if (!propertyId) return
    setLoading(true)
    setError(null)

    leasesApi.list(propertyId)
      .then(async (res) => {
        const leases = res.items
        const enriched = await Promise.all(
          leases.map(async (lease): Promise<TenantRow> => {
            const [tenantRes, summaryRes] = await Promise.allSettled([
              tenantsApi.get(lease.tenant_id),
              paymentsApi.list(lease.id),
            ])
            return {
              lease,
              tenant: tenantRes.status === 'fulfilled' ? tenantRes.value : null,
              summary: summaryRes.status === 'fulfilled' ? summaryRes.value : null,
            }
          })
        )
        setRows(enriched)
      })
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadRows()
  }, [propertyId])

  async function handleDownloadPdf(leaseId: string) {
    setActionLoading(leaseId + ':pdf')
    setActionError(null)
    try {
      const { url } = await leasesApi.getPdf(leaseId)
      window.open(url, '_blank')
    } catch (err) {
      setActionError(extractApiError(err).message)
    } finally {
      setActionLoading(null)
      setMenuOpenLeaseId(null)
    }
  }

  async function handleResendInvite(leaseId: string) {
    setActionLoading(leaseId + ':invite')
    setActionError(null)
    try {
      await leasesApi.resendInvite(leaseId)
      setActionError(null)
      alert('Invite resent successfully')
    } catch (err) {
      setActionError(extractApiError(err).message)
    } finally {
      setActionLoading(null)
      setMenuOpenLeaseId(null)
    }
  }

  async function handleTerminate(leaseId: string) {
    if (!confirm('Are you sure you want to terminate this lease? This action cannot be undone.')) return
    setActionLoading(leaseId + ':terminate')
    setActionError(null)
    try {
      await leasesApi.terminate(leaseId)
      loadRows()
    } catch (err) {
      setActionError(extractApiError(err).message)
    } finally {
      setActionLoading(null)
      setMenuOpenLeaseId(null)
    }
  }

  function handleDiscountUpdated(updatedLease: Lease) {
    setRows(prev => prev.map(r =>
      r.lease.id === updatedLease.id ? { ...r, lease: updatedLease } : r
    ))
    setDiscountLease(null)
  }

  const statusFiltered = statusFilter === 'all'
    ? rows
    : rows.filter((r) => r.lease.status === statusFilter)

  const q = search.trim().toLowerCase()
  const searched = q
    ? statusFiltered.filter((r) => {
        const name = `${r.tenant?.first_name ?? ''} ${r.tenant?.last_name ?? ''}`.toLowerCase()
        const unit = (r.lease.unit_code ?? r.lease.unit_id).toLowerCase()
        return name.includes(q) || unit.includes(q)
      })
    : statusFiltered

  const filtered = [...searched].sort((a, b) => {
    if (sortBy === 'name') {
      const na = `${a.tenant?.first_name ?? ''} ${a.tenant?.last_name ?? ''}`.toLowerCase()
      const nb = `${b.tenant?.first_name ?? ''} ${b.tenant?.last_name ?? ''}`.toLowerCase()
      return na.localeCompare(nb)
    }
    if (sortBy === 'rent') return b.lease.rent_amount - a.lease.rent_amount
    if (sortBy === 'arrears') {
      const aa = a.summary ? calcRentArrears(a.lease, a.summary) : 0
      const ab = b.summary ? calcRentArrears(b.lease, b.summary) : 0
      return ab - aa
    }
    if (sortBy === 'expiry') {
      const da = daysUntil(a.lease.end_date) ?? 9999
      const db = daysUntil(b.lease.end_date) ?? 9999
      return da - db
    }
    return 0
  })

  const counts = {
    all:        rows.length,
    active:     rows.filter((r) => r.lease.status === 'active').length,
    draft:      rows.filter((r) => r.lease.status === 'draft').length,
    expired:    rows.filter((r) => r.lease.status === 'expired').length,
    terminated: rows.filter((r) => r.lease.status === 'terminated').length,
  }

  // ── Metrics ────────────────────────────────────────────────────────────────
  const activeRows = rows.filter((r) => r.lease.status === 'active')
  const paidRows   = activeRows.filter((r) => r.summary && calcRentArrears(r.lease, r.summary) === 0)
  const arrearsRows = activeRows.filter((r) => r.summary && calcRentArrears(r.lease, r.summary) > 0)
  const expiringRows = activeRows.filter((r) => { const d = daysUntil(r.lease.end_date); return d !== null && d >= 0 && d <= 60 })
  const totalMonthlyRent = activeRows.reduce((s, r) => s + (r.lease.effective_rent ?? r.lease.rent_amount), 0)
  const totalArrears = activeRows.reduce((s, r) => s + (r.summary ? calcRentArrears(r.lease, r.summary) : 0), 0)
  const occupancyRate = rows.length > 0 ? Math.round((activeRows.length / rows.length) * 100) : 0

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Tenants" />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} of ${rows.length} lease${rows.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => isUnlocked ? undefined : setShowMfa(true)}
            title={isUnlocked ? 'PII visible — session active' : 'Unlock to view PII'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              isUnlocked
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span>{isUnlocked ? '🔓' : '🔒'}</span>
            {isUnlocked ? 'PII Unlocked' : 'View PII'}
          </button>
          {!loading && rows.length > 0 && (
            <button
              onClick={() => setShowBulkMessage(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              <span>💬</span>
              Bulk Communicate
            </button>
          )}
        </div>
      </div>

      {/* Metric cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
          <MetricCard label="Active" value={String(activeRows.length)} accent="blue" sub={`${occupancyRate}% occ.`} />
          <MetricCard label="Monthly Rent" value={`KES ${fmt(totalMonthlyRent)}`} accent="green" />
          <MetricCard label="In Arrears" value={String(arrearsRows.length)} accent="red" sub={totalArrears > 0 ? `KES ${fmt(totalArrears)}` : undefined} />
          <MetricCard label="Paid Up" value={String(paidRows.length)} accent="emerald" />
          <MetricCard label="Expiring ≤60d" value={String(expiringRows.length)} accent={expiringRows.length > 0 ? 'orange' : 'gray'} />
          <MetricCard label="Draft" value={String(counts.draft)} accent="gray" />
          <MetricCard label="Terminated" value={String(counts.terminated)} accent="gray" />
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}
      {actionError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{actionError}</div>
      )}

      {/* Filters row */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* Status tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['active', 'draft', 'expired', 'terminated', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={[
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  statusFilter === s
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
                <span className="ml-1.5 text-[10px] text-gray-400">{counts[s]}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[180px] max-w-xs relative">
            <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search name or unit…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute inset-y-0 right-2.5 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="name">Sort: Name</option>
            <option value="rent">Sort: Rent ↓</option>
            <option value="arrears">Sort: Arrears ↓</option>
            <option value="expiry">Sort: Expiry ↑</option>
          </select>
        </div>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 h-20 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <span className="text-4xl block mb-3">👥</span>
          <p className="text-sm font-medium text-gray-700 mb-1">No tenants found</p>
          <p className="text-xs text-gray-400 mt-1">
            {statusFilter === 'all'
              ? 'No leases have been created for this property yet.'
              : `No ${statusFilter} leases.`}
          </p>
          {statusFilter !== 'all' && (
            <button
              onClick={() => setStatusFilter('all')}
              className="mt-3 text-xs text-blue-600 underline"
            >
              Show all
            </button>
          )}
        </div>
      )}

      {/* Tenant table */}
      {!loading && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1.2fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Tenant</span>
            <span>Unit</span>
            <span>Lease / Expiry</span>
            <span>Behaviour Score</span>
            <span>Arrears / Credit</span>
            <span />
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100">
            {filtered.map(({ lease, tenant, summary }) => {
              const days = daysUntil(lease.end_date)
              const expiry = expiryLabel(days)
              const arrears = summary ? calcRentArrears(lease, summary) : 0
              const credit = summary ? calcCredit(lease, summary) : 0

              return (
                <div
                  key={lease.id}
                  onClick={() => setSelectedRow({ lease, tenant, summary })}
                  className="grid grid-cols-[2fr_1fr_1.2fr_1fr_1fr_auto] gap-4 items-center px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  {/* Tenant */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-blue-700">
                        {tenant
                          ? tenant.first_name.charAt(0).toUpperCase()
                          : '?'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {tenant
                          ? `${tenant.first_name} ${tenant.last_name}`
                          : <span className="text-gray-400 italic">Unknown</span>}
                      </p>
                      <p className={`text-xs truncate ${isUnlocked ? 'text-gray-500' : 'text-gray-400'}`}>
                        {tenant ? (isUnlocked ? tenant.email : maskEmail(tenant.email)) : '—'}
                      </p>
                      {tenant?.phone && (
                        <p className="text-[10px] text-gray-400">
                          {isUnlocked ? tenant.phone : maskPhone(tenant.phone)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Unit */}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {lease.unit_code ?? <span className="text-gray-400">—</span>}
                    </p>
                    <span
                      className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[lease.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {lease.status}
                    </span>
                  </div>

                  {/* Lease / Expiry */}
                  <div>
                    <p className="text-xs text-gray-500">
                      {new Date(lease.start_date).toLocaleDateString('en-KE', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                      {lease.end_date && (
                        <>
                          {' → '}
                          {new Date(lease.end_date).toLocaleDateString('en-KE', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </>
                      )}
                    </p>
                    <p className={`text-xs mt-0.5 ${expiry.cls}`}>{expiry.text}</p>
                    <div className="mt-0.5">
                      {lease.discount_amount > 0 ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400 line-through">KES {fmt(lease.rent_amount)}/mo</span>
                          <span className="text-[10px] text-green-700 font-semibold">KES {fmt(lease.effective_rent)}/mo</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-400">Rent: KES {fmt(lease.rent_amount)}/mo</p>
                      )}
                    </div>
                  </div>

                  {/* Behaviour Score */}
                  {(() => {
                    const bs = computeBehaviourScore(lease, summary)
                    return (
                      <div className="flex items-start gap-2.5">
                        {/* Score badge */}
                        <div className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl border ${bs.bg} ${bs.border} shrink-0`}>
                          {bs.source === 'insufficient' ? (
                            <span className="text-gray-400 text-lg font-bold">—</span>
                          ) : (
                            <>
                              <span className={`text-sm font-bold leading-none ${bs.color}`}>{bs.score}</span>
                              <span className={`text-[8px] leading-none mt-0.5 ${bs.color} opacity-70`}>/100</span>
                            </>
                          )}
                        </div>
                        {/* Label + details */}
                        <div className="min-w-0 pt-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-semibold ${bs.color}`}>{bs.label}</span>
                            {bs.source === 'estimated' && (
                              <span className="text-[9px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">Est.</span>
                            )}
                            {bs.source === 'rated' && (
                              <span className="text-[9px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded">Rated</span>
                            )}
                          </div>
                          {/* Sub-dimensions (when rated) */}
                          {bs.subs ? (
                            <div className="mt-1 space-y-0.5">
                              {bs.subs.map((sub) => (
                                <div key={sub.label} className="flex items-center gap-1.5">
                                  <span className="text-[9px] text-gray-400 w-10 shrink-0">{sub.label}</span>
                                  <div className="flex gap-0.5">
                                    {[1, 2, 3, 4, 5].map((pip) => (
                                      <div
                                        key={pip}
                                        className={`w-2 h-1.5 rounded-sm ${pip <= Math.round(sub.value) ? 'bg-blue-400' : 'bg-gray-200'}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : bs.source === 'estimated' ? (
                            <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">
                              {summary && summary.outstanding_balance > 0
                                ? `KES ${fmt(summary.outstanding_balance)} arrears`
                                : 'Based on payments'}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Arrears / Credit */}
                  <div>
                    {summary ? (
                      arrears > 0 ? (
                        <>
                          <p className="text-xs font-semibold text-red-600">
                            KES {fmt(arrears)} overdue
                          </p>
                          <p className="text-[10px] text-red-400">Rent arrears</p>
                        </>
                      ) : credit > 0 ? (
                        <>
                          <p className="text-xs font-semibold text-emerald-600">
                            KES {fmt(credit)} credit
                          </p>
                          <p className="text-[10px] text-emerald-500">Prepayment balance</p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">Clear</p>
                      )
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedRow({ lease, tenant, summary })
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
                    >
                      View
                    </button>
                    <div className="relative" ref={menuOpenLeaseId === lease.id ? menuRef : undefined}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (menuOpenLeaseId === lease.id) {
                            setMenuOpenLeaseId(null)
                            setMenuPos(null)
                          } else {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                            setMenuOpenLeaseId(lease.id)
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                        title="More actions"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                      {menuOpenLeaseId === lease.id && menuPos && createPortal(
                        <div
                          ref={menuRef}
                          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
                          className="bg-white rounded-xl shadow-xl border border-gray-100 py-1 w-48"
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(lease.id) }}
                            disabled={actionLoading === lease.id + ':pdf'}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                          >
                            <span>Download PDF</span>
                          </button>
                          {['draft', 'pending_payment', 'pending_signature'].includes(lease.status) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleResendInvite(lease.id) }}
                              disabled={actionLoading === lease.id + ':invite'}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                            >
                              <span>Resend Invite</span>
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpenLeaseId(null)
                              setDiscountLease(lease)
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <span>Apply Discount</span>
                          </button>
                          {!['terminated', 'expired'].includes(lease.status) && (
                            <>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={(e) => { e.stopPropagation(); handleTerminate(lease.id) }}
                                disabled={actionLoading === lease.id + ':terminate'}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
                              >
                                <span>Cancel Lease</span>
                              </button>
                            </>
                          )}
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}


      {/* Tenant slide-over */}
      <TenantSlideOver
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
        onTenantUpdated={(updated) => {
          setRows((prev) =>
            prev.map((r) => r.tenant?.id === updated.id ? { ...r, tenant: updated } : r)
          )
          setSelectedRow((prev) => prev ? { ...prev, tenant: updated } : null)
        }}
      />

      {/* Apply Discount Modal */}
      {discountLease && (
        <ApplyDiscountModal
          lease={discountLease}
          onClose={() => setDiscountLease(null)}
          onUpdated={handleDiscountUpdated}
        />
      )}

      {/* Bulk Message slide-over */}
      {showBulkMessage && propertyId && (
        <BulkMessageSlideOver
          propertyId={propertyId}
          rows={filtered}
          onClose={() => setShowBulkMessage(false)}
        />
      )}

      {showMfa && (
        <MfaPinModal
          onUnlocked={(token, expiresIn) => { unlock(token, expiresIn); setShowMfa(false) }}
          onClose={() => setShowMfa(false)}
        />
      )}
    </div>
  )
}

function MetricCard({
  label, value, sub, accent,
}: {
  label: string
  value: string
  sub?: string
  accent: 'blue' | 'green' | 'red' | 'emerald' | 'orange' | 'gray'
}) {
  const colors: Record<string, string> = {
    blue:    'bg-blue-50   border-blue-200   text-blue-700',
    green:   'bg-green-50  border-green-200  text-green-700',
    red:     'bg-red-50    border-red-200    text-red-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    gray:    'bg-gray-50   border-gray-200   text-gray-600',
  }
  return (
    <div className={`rounded-xl border p-3 ${colors[accent]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70 mb-1">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}
