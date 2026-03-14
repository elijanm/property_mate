import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { CollectionRateData, CollectionRateRow } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(n: number | null) {
  return n == null ? '—' : `${n}%`
}

function rateColor(rate: number | null): string {
  if (rate == null) return 'text-gray-400'
  if (rate >= 90) return 'text-emerald-600'
  if (rate >= 70) return 'text-amber-600'
  return 'text-red-600'
}

function rateBg(rate: number | null): string {
  if (rate == null) return 'bg-gray-100'
  if (rate >= 90) return 'bg-emerald-500'
  if (rate >= 70) return 'bg-amber-400'
  return 'bg-red-500'
}

// ── Trend Chart (SVG) ─────────────────────────────────────────────────────────

function TrendChart({ rows }: { rows: CollectionRateRow[] }) {
  const W = 800
  const H = 180
  const PAD = { top: 16, right: 24, bottom: 40, left: 44 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  // Only rows with data
  const dataRows = rows.filter((r) => r.collection_rate !== null)
  if (dataRows.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-200">
        Not enough data to render chart (need at least 2 months with invoices)
      </div>
    )
  }

  const allRates = dataRows.map((r) => r.collection_rate as number)
  const maxRate = 100
  const minRate = Math.max(0, Math.min(...allRates) - 10)

  const xStep = innerW / (rows.length - 1)

  function xOf(i: number) {
    return PAD.left + i * xStep
  }
  function yOf(rate: number) {
    return PAD.top + innerH - ((rate - minRate) / (maxRate - minRate)) * innerH
  }

  // Build polyline points for collection rate
  const crPoints = rows
    .map((r, i) => (r.collection_rate !== null ? `${xOf(i)},${yOf(r.collection_rate)}` : null))
    .filter(Boolean)
    .join(' ')

  const otPoints = rows
    .map((r, i) => (r.on_time_rate !== null ? `${xOf(i)},${yOf(r.on_time_rate)}` : null))
    .filter(Boolean)
    .join(' ')

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100].filter((v) => v >= minRate)

  const shortMonth = (mk: string) => {
    const [, m] = mk.split('-')
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m) - 1] ?? m
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center gap-4 mb-3">
        <p className="text-xs font-semibold text-gray-700">12-Month Trend</p>
        <div className="flex gap-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-blue-500 inline-block" /> Collection Rate</span>
          <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-emerald-500 inline-block" /> On-Time Rate</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} y1={yOf(v)} x2={W - PAD.right} y2={yOf(v)}
              stroke="#e5e7eb" strokeWidth="1"
            />
            <text x={PAD.left - 6} y={yOf(v)} textAnchor="end" dominantBaseline="middle"
              fontSize="10" fill="#9ca3af">{v}%</text>
          </g>
        ))}

        {/* 90% target line */}
        {90 >= minRate && (
          <line
            x1={PAD.left} y1={yOf(90)} x2={W - PAD.right} y2={yOf(90)}
            stroke="#d1fae5" strokeWidth="1.5" strokeDasharray="4 3"
          />
        )}

        {/* Collection rate area fill */}
        {dataRows.length > 1 && (() => {
          const pts = rows.map((r, i) =>
            r.collection_rate !== null ? `${xOf(i)},${yOf(r.collection_rate)}` : null
          ).filter(Boolean)
          const first = `${xOf(rows.findIndex((r) => r.collection_rate !== null))},${yOf(0)}`
          const last = `${xOf(rows.map((r) => r.collection_rate).lastIndexOf(rows.map((r) => r.collection_rate).filter((v) => v !== null).slice(-1)[0] as number))},${yOf(0)}`
          return (
            <polygon
              points={`${first} ${pts.join(' ')} ${last}`}
              fill="#3b82f6" fillOpacity="0.07"
            />
          )
        })()}

        {/* Lines */}
        {crPoints && (
          <polyline points={crPoints} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        )}
        {otPoints && (
          <polyline points={otPoints} fill="none" stroke="#10b981" strokeWidth="1.5"
            strokeLinejoin="round" strokeDasharray="5 3" />
        )}

        {/* Dots for collection rate */}
        {rows.map((r, i) =>
          r.collection_rate !== null ? (
            <circle key={i} cx={xOf(i)} cy={yOf(r.collection_rate)} r="3"
              fill={r.collection_rate >= 90 ? '#10b981' : r.collection_rate >= 70 ? '#f59e0b' : '#ef4444'}
              stroke="white" strokeWidth="1.5"
            >
              <title>{r.billing_month}: {r.collection_rate}%</title>
            </circle>
          ) : null
        )}

        {/* X-axis labels */}
        {rows.map((r, i) => (
          <text key={i} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {shortMonth(r.billing_month)}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: CollectionRateData }) {
  const s = data.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-5">
      {/* Rate cards — prominent */}
      <div className="col-span-2 sm:col-span-1 bg-white border-2 border-blue-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-blue-500 uppercase tracking-wide font-semibold">Collection Rate</p>
        <p className={`mt-1 text-3xl font-bold ${rateColor(s.collection_rate)}`}>{pct(s.collection_rate)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">last {data.period_months} months</p>
      </div>
      <div className="bg-white border-2 border-emerald-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-emerald-600 uppercase tracking-wide font-semibold">On-Time Rate</p>
        <p className={`mt-1 text-2xl font-bold ${rateColor(s.on_time_rate)}`}>{pct(s.on_time_rate)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">paid before due date</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Total Invoiced</p>
        <p className="mt-1 text-base font-bold text-gray-900">KSh {fmt(s.total_invoiced)}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Collected</p>
        <p className="mt-1 text-base font-bold text-gray-900">KSh {fmt(s.total_collected)}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Outstanding</p>
        <p className={`mt-1 text-base font-bold ${s.total_outstanding > 0 ? 'text-red-600' : 'text-gray-900'}`}>
          KSh {fmt(s.total_outstanding)}
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Invoices</p>
        <p className="mt-1 text-base font-bold text-gray-900">{s.total_invoices}</p>
        <p className="text-[11px] text-gray-400">{s.paid_invoices} fully paid</p>
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────

function MonthTable({ rows }: { rows: CollectionRateRow[] }) {
  // Display newest first
  const sorted = [...rows].reverse()

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {[
              'Month', 'Invoices', 'Total Invoiced', 'Collected', 'Outstanding',
              'Paid', 'On-Time', 'Late', 'Partial', 'Unpaid',
              'Collection Rate', 'On-Time Rate',
            ].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row) => {
            const noData = row.invoice_count === 0
            return (
              <tr key={row.billing_month} className={noData ? 'opacity-40' : 'hover:bg-gray-50 transition-colors'}>
                <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{row.billing_month}</td>
                <td className="px-4 py-3 text-center text-gray-700">{row.invoice_count || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-700">{noData ? '—' : fmt(row.total_invoiced)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{noData ? '—' : fmt(row.total_collected)}</td>
                <td className={`px-4 py-3 text-right ${!noData && row.total_outstanding > 0 ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                  {noData ? '—' : fmt(row.total_outstanding)}
                </td>
                <td className="px-4 py-3 text-center text-gray-700">{noData ? '—' : row.paid_count}</td>
                <td className="px-4 py-3 text-center text-emerald-700">{noData ? '—' : row.on_time_count}</td>
                <td className="px-4 py-3 text-center text-amber-700">{noData ? '—' : row.late_count}</td>
                <td className="px-4 py-3 text-center text-blue-700">{noData ? '—' : row.partial_count}</td>
                <td className="px-4 py-3 text-center text-red-600">{noData ? '—' : row.unpaid_count}</td>
                <td className="px-4 py-3">
                  {noData ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${rateBg(row.collection_rate)}`}
                          style={{ width: `${row.collection_rate ?? 0}%` }}
                        />
                      </div>
                      <span className={`font-bold ${rateColor(row.collection_rate)}`}>
                        {pct(row.collection_rate)}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {noData ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${rateBg(row.on_time_rate)}`}
                          style={{ width: `${row.on_time_rate ?? 0}%` }}
                        />
                      </div>
                      <span className={`font-bold ${rateColor(row.on_time_rate)}`}>
                        {pct(row.on_time_rate)}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [3, 6, 12, 24] as const

export default function CollectionRateReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<CollectionRateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState(12)
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      setData(await reportsApi.getCollectionRate(propertyId, months))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId, months])

  useEffect(() => { load() }, [load])

  const handleExport = async (format: 'csv' | 'tsv') => {
    if (!propertyId || exporting) return
    setExporting(format)
    try {
      const blob = await reportsApi.exportCollectionRate(propertyId, months, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `collection_rate_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex items-center justify-center py-32">
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
            <h1 className="text-2xl font-bold text-gray-900">Collection Rate</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · Generated {data?.generated_at.slice(0, 10)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  months === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m}mo
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

      {/* Chart */}
      {data && (
        <div className="mb-6">
          <TrendChart rows={data.rows} />
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> ≥ 90% — Excellent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> 70–89% — Needs attention
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> &lt; 70% — Critical
        </span>
      </div>

      {/* Table */}
      {data && <MonthTable rows={data.rows} />}
    </div>
  )
}
