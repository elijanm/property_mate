import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { PaymentBehaviorData, PaymentBehaviorRow } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Tier = 'excellent' | 'good' | 'poor' | 'none'

function scoreTier(score: number | null): Tier {
  if (score === null) return 'none'
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  return 'poor'
}

const TIER_META: Record<Tier, { label: string; color: string; bg: string; border: string; bar: string; ring: string }> = {
  excellent: { label: 'Excellent', color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', bar: 'bg-emerald-500', ring: 'ring-emerald-300' },
  good:      { label: 'Good',      color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-200',   bar: 'bg-blue-500',    ring: 'ring-blue-300'   },
  poor:      { label: 'Poor',      color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',    bar: 'bg-red-500',     ring: 'ring-red-300'    },
  none:      { label: 'No data',   color: 'text-gray-400',    bg: 'bg-gray-50',     border: 'border-gray-200',   bar: 'bg-gray-300',    ring: 'ring-gray-200'   },
}

// Circular score badge
function ScoreBadge({ score }: { score: number | null }) {
  const tier = scoreTier(score)
  const m = TIER_META[tier]
  const r = 18
  const circ = 2 * Math.PI * r
  const fill = score != null ? (score / 100) * circ : 0

  return (
    <div className="relative inline-flex items-center justify-center w-14 h-14">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3.5" />
        <circle
          cx="22" cy="22" r={r} fill="none"
          stroke={tier === 'excellent' ? '#10b981' : tier === 'good' ? '#3b82f6' : tier === 'poor' ? '#ef4444' : '#d1d5db'}
          strokeWidth="3.5"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`relative text-sm font-bold ${m.color}`}>
        {score != null ? score : '—'}
      </span>
    </div>
  )
}

function TierBadge({ score }: { score: number | null }) {
  const tier = scoreTier(score)
  const m = TIER_META[tier]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.bg} ${m.color} ${m.border}`}>
      {m.label}
    </span>
  )
}

// ── Summary ───────────────────────────────────────────────────────────────────

function SummarySection({ data }: { data: PaymentBehaviorData }) {
  const s = data.summary

  return (
    <div className="space-y-4 mb-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <div className="col-span-2 sm:col-span-1 bg-white border-2 border-blue-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
          <ScoreBadge score={s.avg_reliability_score} />
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide font-semibold">Avg Score</p>
            <p className="text-lg font-bold text-gray-900">{s.avg_reliability_score ?? '—'}</p>
            <p className="text-[11px] text-gray-400">property avg</p>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Avg On-Time</p>
          <p className={`mt-1 text-xl font-bold ${s.avg_on_time_rate != null && s.avg_on_time_rate >= 80 ? 'text-emerald-600' : s.avg_on_time_rate != null && s.avg_on_time_rate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
            {s.avg_on_time_rate != null ? `${s.avg_on_time_rate}%` : '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Avg Delay</p>
          <p className={`mt-1 text-xl font-bold ${(s.avg_payment_delay_days ?? 0) <= 5 ? 'text-emerald-600' : (s.avg_payment_delay_days ?? 0) <= 15 ? 'text-amber-600' : 'text-red-600'}`}>
            {s.avg_payment_delay_days != null ? `${s.avg_payment_delay_days}d` : '—'}
          </p>
        </div>
        <div className={`bg-white border-2 ${TIER_META.excellent.border} rounded-xl p-4 shadow-sm`}>
          <p className={`text-[10px] uppercase tracking-wide font-semibold ${TIER_META.excellent.color}`}>Excellent ≥80</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{s.excellent_count}</p>
        </div>
        <div className={`bg-white border ${TIER_META.good.border} rounded-xl p-4 shadow-sm`}>
          <p className={`text-[10px] uppercase tracking-wide font-semibold ${TIER_META.good.color}`}>Good 60–79</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">{s.good_count}</p>
        </div>
        <div className={`bg-white border ${TIER_META.poor.border} rounded-xl p-4 shadow-sm`}>
          <p className={`text-[10px] uppercase tracking-wide font-semibold ${TIER_META.poor.color}`}>Poor &lt;60</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{s.poor_count}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Tenants</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{s.tenant_count}</p>
        </div>
      </div>

      {/* Score distribution bar */}
      {s.tenant_count > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 mb-2">Score distribution</p>
          <div className="flex rounded-full overflow-hidden h-3 w-full bg-gray-100">
            {[
              { count: s.excellent_count, cls: 'bg-emerald-500' },
              { count: s.good_count,      cls: 'bg-blue-500' },
              { count: s.poor_count,      cls: 'bg-red-500' },
            ].map(({ count, cls }) =>
              count > 0 ? (
                <div
                  key={cls}
                  className={cls}
                  style={{ width: `${(count / s.tenant_count) * 100}%` }}
                />
              ) : null
            )}
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-gray-500">
            {[
              { label: 'Excellent', cls: 'bg-emerald-500', count: s.excellent_count },
              { label: 'Good',      cls: 'bg-blue-500',    count: s.good_count },
              { label: 'Poor',      cls: 'bg-red-500',     count: s.poor_count },
            ].map(({ label, cls, count }) => (
              <span key={label} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${cls} inline-block`} />
                {label} ({count})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

type SortKey = 'score' | 'delay' | 'on_time' | 'outstanding'

function TableView({ rows }: { rows: PaymentBehaviorRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(true)

  const sorted = [...rows].sort((a, b) => {
    const valA = sortKey === 'score' ? (a.reliability_score ?? -1)
      : sortKey === 'delay' ? (a.avg_payment_delay_days ?? 999)
      : sortKey === 'on_time' ? (a.on_time_rate ?? -1)
      : a.outstanding_balance
    const valB = sortKey === 'score' ? (b.reliability_score ?? -1)
      : sortKey === 'delay' ? (b.avg_payment_delay_days ?? 999)
      : sortKey === 'on_time' ? (b.on_time_rate ?? -1)
      : b.outstanding_balance
    return sortAsc ? valA - valB : valB - valA
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'score' ? true : key === 'delay' ? false : false) }
  }

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col
    return (
      <th
        onClick={() => toggleSort(col)}
        className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-900 transition-colors"
      >
        {label}
        <span className="ml-1 opacity-50">{active ? (sortAsc ? '↑' : '↓') : '↕'}</span>
      </th>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Tenant</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
            <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Invoices</th>
            <SortTh col="on_time" label="On-Time Rate" />
            <SortTh col="delay" label="Avg Delay" />
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Last Payment</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Outstanding</th>
            <SortTh col="score" label="Score" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row) => {
            const tier = scoreTier(row.reliability_score)
            const m = TIER_META[tier]
            return (
              <tr key={row.tenant_id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900 whitespace-nowrap">{row.tenant_name}</p>
                  {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
                </td>
                <td className="px-4 py-3 font-medium text-gray-700">{row.unit_code}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-gray-700">{row.total_invoices}</span>
                  <span className="text-gray-400 mx-1">·</span>
                  <span className="text-emerald-600">{row.paid_count}p</span>
                  {row.partial_count > 0 && <><span className="text-gray-400 mx-1">·</span><span className="text-amber-600">{row.partial_count}pa</span></>}
                  {row.unpaid_count > 0 && <><span className="text-gray-400 mx-1">·</span><span className="text-red-500">{row.unpaid_count}u</span></>}
                </td>
                <td className="px-4 py-3">
                  {row.on_time_rate != null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${m.bar}`}
                          style={{ width: `${row.on_time_rate}%` }}
                        />
                      </div>
                      <span className={`font-semibold ${m.color}`}>{row.on_time_rate}%</span>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.avg_payment_delay_days != null ? (
                    <span className={`font-medium ${row.avg_payment_delay_days <= 3 ? 'text-emerald-600' : row.avg_payment_delay_days <= 14 ? 'text-amber-600' : 'text-red-600'}`}>
                      {row.avg_payment_delay_days}d
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {row.last_payment_date ?? <span className="text-red-500 font-medium">Never</span>}
                </td>
                <td className={`px-4 py-3 text-right font-medium ${row.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  {row.outstanding_balance > 0 ? `KSh ${fmt(row.outstanding_balance)}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={row.reliability_score} />
                    <TierBadge score={row.reliability_score} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Visual Cards ──────────────────────────────────────────────────────────────

function VisualCard({ row }: { row: PaymentBehaviorRow }) {
  const tier = scoreTier(row.reliability_score)
  const m = TIER_META[tier]

  return (
    <div className={`bg-white rounded-xl border-2 ${m.border} overflow-hidden hover:shadow-md transition-shadow`}>
      <div className={`h-1 w-full ${m.bar}`} />
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">{row.tenant_name}</p>
            <p className="text-[11px] text-gray-400">{row.unit_code}</p>
            {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
          </div>
          <ScoreBadge score={row.reliability_score} />
        </div>

        <TierBadge score={row.reliability_score} />

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">On-Time Rate</p>
            <p className={`text-base font-bold ${m.color}`}>
              {row.on_time_rate != null ? `${row.on_time_rate}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Delay</p>
            <p className={`text-base font-bold ${
              row.avg_payment_delay_days == null ? 'text-gray-400' :
              row.avg_payment_delay_days <= 3 ? 'text-emerald-600' :
              row.avg_payment_delay_days <= 14 ? 'text-amber-600' : 'text-red-600'
            }`}>
              {row.avg_payment_delay_days != null ? `${row.avg_payment_delay_days}d` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Invoices</p>
            <p className="text-sm font-medium text-gray-700">
              {row.paid_count}/{row.total_invoices} paid
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Outstanding</p>
            <p className={`text-sm font-semibold ${row.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {row.outstanding_balance > 0 ? `KSh ${fmt(row.outstanding_balance)}` : 'Clear'}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-gray-400">
          Last payment: {row.last_payment_date ?? <span className="text-red-500 font-medium">Never</span>}
        </p>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TierFilter = 'all' | Tier

export default function PaymentBehaviorReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<PaymentBehaviorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'visual'>('table')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      setData(await reportsApi.getPaymentBehavior(propertyId))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const handleExport = async (format: 'csv' | 'tsv') => {
    if (!propertyId || exporting) return
    setExporting(format)
    try {
      const blob = await reportsApi.exportPaymentBehavior(propertyId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payment_behavior_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const allRows = data?.rows ?? []
  const filtered = tierFilter === 'all' ? allRows : allRows.filter((r) => scoreTier(r.reliability_score) === tierFilter)

  const FILTERS: { key: TierFilter; label: string }[] = [
    { key: 'all',       label: `All (${allRows.length})` },
    { key: 'excellent', label: `Excellent ≥80 (${allRows.filter(r => scoreTier(r.reliability_score) === 'excellent').length})` },
    { key: 'good',      label: `Good 60–79 (${allRows.filter(r => scoreTier(r.reliability_score) === 'good').length})` },
    { key: 'poor',      label: `Poor <60 (${allRows.filter(r => scoreTier(r.reliability_score) === 'poor').length})` },
    { key: 'none',      label: `No data (${allRows.filter(r => r.reliability_score === null).length})` },
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
            <h1 className="text-2xl font-bold text-gray-900">Tenant Payment Behavior</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · {data?.generated_at.slice(0, 10)} · Worst first by default
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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

      {data && <SummarySection data={data} />}

      {/* Score methodology note */}
      <div className="mb-5 text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-4 py-2">
        <strong className="text-gray-500">Score formula:</strong> 60% on-time rate · 30% delay component (−3 pts/day avg late) · 10% paid rate.
        Excellent ≥ 80 · Good 60–79 · Poor &lt; 60
      </div>

      {/* Tier filters */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {FILTERS.map(({ key, label }) => {
          const m = key !== 'all' && key !== 'none' ? TIER_META[key] : null
          return (
            <button
              key={key}
              onClick={() => setTierFilter(key)}
              className={[
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                tierFilter === key
                  ? m ? `${m.bar} text-white` : 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-600 font-medium">No tenants in this category</p>
        </div>
      ) : view === 'table' ? (
        <TableView rows={filtered} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((row) => <VisualCard key={row.tenant_id} row={row} />)}
        </div>
      )}
    </div>
  )
}
