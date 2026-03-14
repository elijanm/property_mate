import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { LeaseExpiryData, LeaseExpiryRow, LeaseUrgency } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const URGENCY_META: Record<LeaseUrgency, { label: string; color: string; bg: string; border: string; bar: string; ring: string }> = {
  critical: {
    label: '≤ 30 days',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    bar: 'bg-red-500',
    ring: 'ring-red-300',
  },
  warning: {
    label: '31–60 days',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    bar: 'bg-orange-400',
    ring: 'ring-orange-300',
  },
  notice: {
    label: '61–90 days',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    bar: 'bg-amber-400',
    ring: 'ring-amber-200',
  },
}

function UrgencyBadge({ urgency }: { urgency: LeaseUrgency }) {
  const m = URGENCY_META[urgency]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.bg} ${m.color} ${m.border}`}>
      {m.label}
    </span>
  )
}

function DaysCountdown({ days, urgency }: { days: number; urgency: LeaseUrgency }) {
  const m = URGENCY_META[urgency]
  return (
    <span className={`text-sm font-bold tabular-nums ${m.color}`}>
      {days}d
    </span>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: LeaseExpiryData }) {
  const s = data.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <div className="col-span-2 sm:col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Expiring Soon</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{s.total}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">within {data.window_days} days</p>
      </div>
      <div className={`bg-white border-2 ${URGENCY_META.critical.border} rounded-xl p-4 shadow-sm`}>
        <p className={`text-[10px] uppercase tracking-wide font-semibold ${URGENCY_META.critical.color}`}>
          Critical ≤30d
        </p>
        <p className="mt-1 text-2xl font-bold text-red-600">{s.critical}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">action required</p>
      </div>
      <div className={`bg-white border ${URGENCY_META.warning.border} rounded-xl p-4 shadow-sm`}>
        <p className={`text-[10px] uppercase tracking-wide font-semibold ${URGENCY_META.warning.color}`}>
          Warning 31–60d
        </p>
        <p className="mt-1 text-2xl font-bold text-orange-600">{s.warning}</p>
      </div>
      <div className={`bg-white border ${URGENCY_META.notice.border} rounded-xl p-4 shadow-sm`}>
        <p className={`text-[10px] uppercase tracking-wide font-semibold ${URGENCY_META.notice.color}`}>
          Notice 61–90d
        </p>
        <p className="mt-1 text-2xl font-bold text-amber-600">{s.notice}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Rent at Risk</p>
        <p className="mt-1 text-base font-bold text-gray-900">KSh {fmt(s.total_rent_at_risk)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">per month</p>
      </div>
    </div>
  )
}

// ── Timeline Bar ──────────────────────────────────────────────────────────────

function TimelineBar({ rows, windowDays }: { rows: LeaseExpiryRow[]; windowDays: number }) {
  if (rows.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm mb-6">
      <p className="text-xs font-semibold text-gray-600 mb-3">Expiry timeline — next {windowDays} days</p>
      <div className="relative h-8">
        {/* Track */}
        <div className="absolute inset-y-3 left-0 right-0 bg-gray-100 rounded-full" />
        {/* Day markers */}
        {[30, 60].filter(d => d < windowDays).map(d => (
          <div
            key={d}
            className="absolute top-0 bottom-0 flex flex-col items-center"
            style={{ left: `${(d / windowDays) * 100}%` }}
          >
            <div className="w-px h-full bg-gray-300" />
            <span className="absolute -bottom-5 text-[9px] text-gray-400 -translate-x-1/2">{d}d</span>
          </div>
        ))}
        {/* Lease dots */}
        {rows.map((row) => {
          const pct = (row.days_remaining / windowDays) * 100
          const m = URGENCY_META[row.urgency]
          return (
            <div
              key={row.lease_id}
              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${m.bar} ring-2 ${m.ring} cursor-default`}
              style={{ left: `calc(${pct}% - 6px)` }}
              title={`${row.tenant_name} · ${row.unit_code} · ${row.days_remaining}d`}
            />
          )
        })}
      </div>
      <div className="mt-7 flex gap-4 text-[10px] text-gray-400">
        <span>Today</span>
        <span className="ml-auto">{windowDays} days</span>
      </div>
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ rows }: { rows: LeaseExpiryRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {['Unit', 'Type', 'Tenant', 'Lease Start', 'Lease End', 'Days Left', 'Urgency', 'Monthly Rent', 'Deposit'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.lease_id} className={`hover:bg-gray-50 transition-colors ${row.urgency === 'critical' ? 'bg-red-50/30' : ''}`}>
              <td className="px-4 py-3 font-bold text-gray-900">{row.unit_code}</td>
              <td className="px-4 py-3 text-gray-500">{row.unit_type || '—'}</td>
              <td className="px-4 py-3">
                <p className="font-semibold text-gray-800 whitespace-nowrap">{row.tenant_name}</p>
                {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
              </td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.lease_start ?? '—'}</td>
              <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{row.lease_end}</td>
              <td className="px-4 py-3 text-center">
                <DaysCountdown days={row.days_remaining} urgency={row.urgency} />
              </td>
              <td className="px-4 py-3"><UrgencyBadge urgency={row.urgency} /></td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">
                KSh {fmt(row.monthly_rent)}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                KSh {fmt(row.deposit_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={7} className="px-4 py-3 text-xs font-semibold text-gray-600">
              {rows.length} lease{rows.length !== 1 ? 's' : ''}
            </td>
            <td className="px-4 py-3 text-right text-xs font-bold text-gray-900">
              KSh {fmt(rows.reduce((a, r) => a + r.monthly_rent, 0))}
            </td>
            <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">
              KSh {fmt(rows.reduce((a, r) => a + r.deposit_amount, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Visual Cards ──────────────────────────────────────────────────────────────

function VisualCard({ row }: { row: LeaseExpiryRow }) {
  const m = URGENCY_META[row.urgency]
  return (
    <div className={`bg-white rounded-xl border-2 ${m.border} overflow-hidden hover:shadow-md transition-shadow`}>
      <div className={`h-1.5 w-full ${m.bar}`} />
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">{row.unit_code}</p>
            {row.unit_type && <p className="text-[11px] text-gray-400">{row.unit_type}</p>}
          </div>
          <UrgencyBadge urgency={row.urgency} />
        </div>

        {/* Countdown — most prominent */}
        <div className={`rounded-lg px-3 py-2 text-center ${m.bg}`}>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Days remaining</p>
          <p className={`text-3xl font-black tabular-nums ${m.color}`}>{row.days_remaining}</p>
          <p className="text-[11px] text-gray-500">expires {row.lease_end}</p>
        </div>

        {/* Tenant */}
        <div>
          <p className="text-xs font-semibold text-gray-800">{row.tenant_name}</p>
          {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
          {row.tenant_email && <p className="text-[11px] text-gray-400 truncate">{row.tenant_email}</p>}
        </div>

        {/* Financials */}
        <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Monthly Rent</p>
            <p className="text-sm font-semibold text-gray-900">KSh {fmt(row.monthly_rent)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Deposit</p>
            <p className="text-sm font-semibold text-gray-900">KSh {fmt(row.deposit_amount)}</p>
          </div>
        </div>

        {row.lease_start && (
          <p className="text-[11px] text-gray-400">Started {row.lease_start}</p>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type UrgencyFilter = 'all' | LeaseUrgency

const WINDOW_OPTIONS = [30, 60, 90, 180] as const

export default function LeaseExpiryReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<LeaseExpiryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(90)
  const [view, setView] = useState<'table' | 'visual'>('table')
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all')
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      setData(await reportsApi.getLeaseExpiry(propertyId, windowDays))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId, windowDays])

  useEffect(() => { load() }, [load])

  const handleExport = async (format: 'csv' | 'tsv') => {
    if (!propertyId || exporting) return
    setExporting(format)
    try {
      const blob = await reportsApi.exportLeaseExpiry(propertyId, windowDays, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lease_expiry_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const allRows = data?.rows ?? []
  const filtered = urgencyFilter === 'all' ? allRows : allRows.filter((r) => r.urgency === urgencyFilter)

  const filterOptions: { key: UrgencyFilter; label: string }[] = [
    { key: 'all',      label: `All (${allRows.length})` },
    { key: 'critical', label: `Critical — ≤30d (${allRows.filter(r => r.urgency === 'critical').length})` },
    { key: 'warning',  label: `Warning — 31–60d (${allRows.filter(r => r.urgency === 'warning').length})` },
    { key: 'notice',   label: `Notice — 61–90d+ (${allRows.filter(r => r.urgency === 'notice').length})` },
  ]

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center py-32">
        <svg className="animate-spin w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <span className="ml-3 text-sm text-gray-500">Generating report…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={load} className="mt-3 text-sm text-red-600 underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Lease Expiry Report</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · Expiring within {windowDays} days · {data?.generated_at.slice(0, 10)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Window selector */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  windowDays === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {(['table', 'visual'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Export */}
          {(['csv', 'tsv'] as const).map((format) => (
            <button
              key={format}
              onClick={() => handleExport(format)}
              disabled={!!exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting === format ? (
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              {format.toUpperCase()}{format === 'csv' ? ' (Excel)' : ' (Legacy)'}
            </button>
          ))}

          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      {data && <SummaryCards data={data} />}

      {/* Timeline */}
      {data && allRows.length > 0 && <TimelineBar rows={allRows} windowDays={windowDays} />}

      {/* Urgency filter */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {filterOptions.map(({ key, label }) => {
          const isUrgency = key !== 'all'
          const m = isUrgency ? URGENCY_META[key as LeaseUrgency] : null
          return (
            <button
              key={key}
              onClick={() => setUrgencyFilter(key)}
              className={[
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                urgencyFilter === key
                  ? m ? `${m.bar} text-white` : 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-600 font-medium">No leases expiring within {windowDays} days</p>
          <p className="text-sm text-gray-400 mt-1">Try extending the window above.</p>
        </div>
      ) : view === 'table' ? (
        <TableView rows={filtered} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((row) => <VisualCard key={row.lease_id} row={row} />)}
        </div>
      )}
    </div>
  )
}
