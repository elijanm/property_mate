import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { MeterReadingsData, MeterReadingRow, MeterLiveCacheEntry, MeterPricingTier } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── helpers ───────────────────────────────────────────────────────────────────

const UTILITY_META: Record<string, { label: string; icon: string; unit: string; color: string; bg: string; dot: string }> = {
  water:       { label: 'Water',       icon: '💧', unit: 'm³',  color: 'text-blue-600',   bg: 'bg-blue-50',   dot: 'bg-blue-500'   },
  electricity: { label: 'Electricity', icon: '⚡', unit: 'kWh', color: 'text-amber-600',  bg: 'bg-amber-50',  dot: 'bg-amber-500'  },
  gas:         { label: 'Gas',         icon: '🔥', unit: 'm³',  color: 'text-orange-600', bg: 'bg-orange-50', dot: 'bg-orange-500' },
  internet:    { label: 'Internet',    icon: '🌐', unit: 'GB',  color: 'text-purple-600', bg: 'bg-purple-50', dot: 'bg-purple-500' },
}
function meta(key: string) {
  return UTILITY_META[key] ?? { label: key, icon: '🔌', unit: 'units', color: 'text-slate-600', bg: 'bg-slate-50', dot: 'bg-slate-500' }
}

function fmtMoney(v: number) {
  return `KSh ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtNum(v: number | null, decimals = 2) {
  if (v === null) return '—'
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Confirmed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      Pending
    </span>
  )
}

// ── Reading delta arrow ───────────────────────────────────────────────────────

function ReadingArrow({ prev, curr, unit }: { prev: number | null; curr: number | null; unit: string }) {
  if (prev === null || curr === null) {
    return <span className="text-slate-300 text-xs">—</span>
  }
  const consumption = curr - prev
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-slate-500 font-mono">{fmtNum(prev)}</span>
      <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="text-slate-800 font-mono font-medium">{fmtNum(curr)}</span>
      <span className="text-slate-400">({fmtNum(consumption, 2)} {unit})</span>
    </div>
  )
}

// ── Rate cell ─────────────────────────────────────────────────────────────────

function RateCell({ row, unit }: { row: MeterReadingRow; unit: string }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopupPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX })
    }
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  if (!row.is_tiered || !row.tiers) {
    return <span className="text-xs text-slate-500">KSh {row.unit_price}/{unit}</span>
  }

  return (
    <div>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
        title="Tiered pricing — click to expand"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Tiered
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className="text-[10px] text-slate-400 mt-0.5">
        eff. KSh {row.effective_rate.toFixed(2)}/{unit}
      </div>
      {open && createPortal(
        <div
          style={{ position: 'absolute', top: popupPos.top, left: popupPos.left, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl p-2 min-w-[180px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tier Schedule</p>
          {row.tiers.map((tier: MeterPricingTier, i: number) => (
            <div key={i} className="flex items-center justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-500">{tier.from_units}–{tier.to_units !== null ? tier.to_units : '∞'} {unit}</span>
              <span className="font-medium text-indigo-700">KSh {tier.rate}/{unit}</span>
            </div>
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex justify-between text-xs">
            <span className="text-slate-400">Effective rate</span>
            <span className="font-semibold text-slate-700">KSh {row.effective_rate.toFixed(2)}/{unit}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Unit card (by-unit view) ──────────────────────────────────────────────────

function UnitCard({ unitCode, unitRows }: {
  unitCode: string
  unitRows: MeterReadingRow[]
}) {
  const [expanded, setExpanded] = useState(false)
  const hasPending = unitRows.some(r => r.status === 'pending')
  const latestByUtility: Record<string, MeterReadingRow> = {}
  for (const row of unitRows) {
    const existing = latestByUtility[row.utility_key]
    if (!existing || row.billing_month > existing.billing_month) {
      latestByUtility[row.utility_key] = row
    }
  }
  const uniqueMonths = Array.from(new Set(unitRows.map(r => r.billing_month))).sort().reverse()

  return (
    <div className={`bg-white rounded-xl border ${hasPending ? 'border-amber-200' : 'border-slate-200'} overflow-hidden`}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-slate-800">{unitCode}</span>
          {hasPending && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
              {unitRows.filter(r => r.status === 'pending').length} pending
            </span>
          )}
          <span className="text-xs text-slate-400">{uniqueMonths.length} period{uniqueMonths.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Latest readings per utility */}
          <div className="flex gap-2">
            {Object.entries(latestByUtility).map(([k, row]) => {
              const m = meta(k)
              return (
                <span key={k} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${m.bg} ${m.color} font-medium`}>
                  {m.icon} {fmtNum(row.current_reading, 1)} {m.unit}
                </span>
              )
            })}
          </div>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Expanded: readings table */}
      {expanded && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-left font-medium">Utility</th>
                <th className="px-4 py-2 text-left font-medium">Meter No.</th>
                <th className="px-4 py-2 text-left font-medium">Reading (prev → curr)</th>
                <th className="px-4 py-2 text-left font-medium">Rate</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-center font-medium">Photo</th>
                <th className="px-4 py-2 text-left font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {[...unitRows].sort((a, b) => b.billing_month.localeCompare(a.billing_month)).map(row => {
                const m = meta(row.utility_key)
                return (
                  <tr key={row.line_item_id} className="border-t border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{row.billing_month}</td>
                    <td className="px-4 py-2">
                      <span className={`flex items-center gap-1 ${m.color}`}>
                        {m.icon} {m.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-500">{row.meter_number}</td>
                    <td className="px-4 py-2">
                      <ReadingArrow prev={row.previous_reading} curr={row.current_reading} unit={m.unit} />
                    </td>
                    <td className="px-4 py-2">
                      <RateCell row={row} unit={m.unit} />
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-slate-700">{fmtMoney(row.amount)}</td>
                    <td className="px-4 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-2 text-center">
                      {row.has_photo
                        ? <span className="text-emerald-500" title="Photo captured">📷</span>
                        : <span className="text-slate-200">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-400">{row.invoice_reference}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewMode = 'units' | 'table'
type FilterStatus = 'all' | 'confirmed' | 'pending'

export default function MeterReadingsReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<MeterReadingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('units')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterUtility, setFilterUtility] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true); setError(null)
    try {
      setData(await reportsApi.getMeterReadings(propertyId))
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const exportReport = async (fmt: 'csv' | 'tsv') => {
    if (!propertyId) return
    setExporting(true)
    try {
      const blob = await reportsApi.exportMeterReadings(propertyId, fmt)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `meter_readings_${propertyId}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading meter readings…</div>
  )
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-red-500 text-sm">{error}</p>
      <button onClick={load} className="text-sm text-blue-600 hover:underline">Retry</button>
    </div>
  )
  if (!data) return null

  const { summary, rows, live_cache, billing_months } = data
  const utilityKeys = Object.keys(summary.by_utility).sort()

  // Filtered flat rows
  const filteredRows = rows.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterUtility !== 'all' && r.utility_key !== filterUtility) return false
    if (filterMonth !== 'all' && r.billing_month !== filterMonth) return false
    return true
  })

  // Group by unit for card view
  const unitGroups: Record<string, { rows: MeterReadingRow[]; unitCode: string }> = {}
  for (const row of filteredRows) {
    if (!unitGroups[row.unit_id]) unitGroups[row.unit_id] = { rows: [], unitCode: row.unit_code }
    unitGroups[row.unit_id].rows.push(row)
  }
  const sortedUnits = Object.entries(unitGroups).sort(([, a], [, b]) => a.unitCode.localeCompare(b.unitCode))

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Meter Readings Report</h1>
              <p className="text-xs text-slate-400">{data.property_name} · Generated {data.generated_at.slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['units', 'table'] as ViewMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'units' ? 'By unit' : 'All readings'}
                </button>
              ))}
            </div>

            <button onClick={load} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" title="Refresh">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-3.36M20 15a9 9 0 01-14.13 3.36" />
              </svg>
            </button>

            <div className="relative group">
              <button
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              <div className="absolute right-0 top-full mt-1 w-28 bg-white rounded-lg shadow-lg border border-slate-200 py-1 hidden group-hover:block z-10">
                <button onClick={() => exportReport('csv')} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">CSV (Excel)</button>
                <button onClick={() => exportReport('tsv')} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">TSV</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total Readings</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{summary.total_readings}</p>
            <p className="text-xs text-slate-400 mt-1">across all periods</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Confirmed</p>
            <p className="text-3xl font-bold text-emerald-600 mt-1">{summary.confirmed}</p>
            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: summary.total_readings > 0 ? `${(summary.confirmed / summary.total_readings) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Pending</p>
            <p className="text-3xl font-bold text-amber-600 mt-1">{summary.pending}</p>
            <p className="text-xs text-slate-400 mt-1">{summary.pending_units} unit{summary.pending_units !== 1 ? 's' : ''} awaiting</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Periods</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{billing_months.length}</p>
            <p className="text-xs text-slate-400 mt-1">{billing_months[0] ?? '—'} latest</p>
          </div>
        </div>

        {/* Per-utility summary */}
        {utilityKeys.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {utilityKeys.map(k => {
              const m = meta(k)
              const u = summary.by_utility[k]
              const total = (u.confirmed ?? 0) + (u.pending ?? 0)
              const confPct = total > 0 ? ((u.confirmed ?? 0) / total) * 100 : 0
              return (
                <div key={k} className={`rounded-xl border border-slate-200 p-4 ${m.bg}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-base">{m.icon}</span>
                    <span className={`text-xs font-semibold ${m.color}`}>{m.label}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>{u.confirmed ?? 0} confirmed</span>
                    <span className="text-amber-600">{u.pending ?? 0} pending</span>
                  </div>
                  <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                    <div className={`h-full ${m.dot} rounded-full`} style={{ width: `${confPct}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {(u.total_consumption ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} {m.unit} total
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Status */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            {([
              { id: 'all',       label: 'All' },
              { id: 'confirmed', label: 'Confirmed' },
              { id: 'pending',   label: 'Pending' },
            ] as { id: FilterStatus; label: string }[]).map(f => (
              <button
                key={f.id}
                onClick={() => setFilterStatus(f.id)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  filterStatus === f.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Utility */}
          {utilityKeys.length > 1 && (
            <select
              value={filterUtility}
              onChange={e => setFilterUtility(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="all">All utilities</option>
              {utilityKeys.map(k => <option key={k} value={k}>{meta(k).icon} {meta(k).label}</option>)}
            </select>
          )}

          {/* Period */}
          {billing_months.length > 1 && (
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="all">All periods</option>
              {billing_months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}

          <span className="ml-auto text-xs text-slate-400">{filteredRows.length} reading{filteredRows.length !== 1 ? 's' : ''}</span>
        </div>

        {/* No data */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-slate-600 font-medium">No meter readings recorded yet.</p>
            <p className="text-sm text-slate-400 mt-1">Readings appear once billing generates metered utility invoices.</p>

            {/* Live cache */}
            {live_cache.length > 0 && <LiveCacheSection entries={live_cache} />}
          </div>
        ) : view === 'units' ? (
          <div className="space-y-3">
            {sortedUnits.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
                No readings match the current filters.
              </div>
            ) : sortedUnits.map(([uid, { rows: urows, unitCode }]) => (
              <UnitCard key={uid} unitCode={unitCode} unitRows={urows} />
            ))}

            {/* Live cache at bottom */}
            {live_cache.length > 0 && filterStatus === 'all' && filterMonth === 'all' && (
              <LiveCacheSection entries={live_cache} />
            )}
          </div>
        ) : (
          /* Flat table */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Unit</th>
                    <th className="px-4 py-3 text-left font-medium">Meter No.</th>
                    <th className="px-4 py-3 text-left font-medium">Utility</th>
                    <th className="px-4 py-3 text-left font-medium">Period</th>
                    <th className="px-4 py-3 text-left font-medium">Previous</th>
                    <th className="px-4 py-3 text-left font-medium">Current</th>
                    <th className="px-4 py-3 text-right font-medium">Consumption</th>
                    <th className="px-4 py-3 text-left font-medium">Rate</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-center font-medium">Photo</th>
                    <th className="px-4 py-3 text-left font-medium">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center text-slate-400 text-sm">No readings match the current filters.</td>
                    </tr>
                  ) : [...filteredRows].sort((a, b) =>
                    b.billing_month.localeCompare(a.billing_month) || a.unit_code.localeCompare(b.unit_code)
                  ).map(row => {
                    const m = meta(row.utility_key)
                    return (
                      <tr key={row.line_item_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.unit_code}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.meter_number}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs font-medium ${m.color}`}>
                            {m.icon} {m.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.billing_month}</td>
                        <td className="px-4 py-3 font-mono text-slate-500 text-xs">
                          {row.previous_reading !== null ? `${fmtNum(row.previous_reading)} ${m.unit}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-800 text-xs font-medium">
                          {row.current_reading !== null ? `${fmtNum(row.current_reading)} ${m.unit}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-semibold ${m.color}`}>
                            {fmtNum(row.consumption, 2)} {m.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <RateCell row={row} unit={m.unit} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(row.amount)}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3 text-center text-base">
                          {row.has_photo ? '📷' : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.invoice_reference}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Live cache section ────────────────────────────────────────────────────────

function LiveCacheSection({ entries }: { entries: MeterLiveCacheEntry[] }) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <h3 className="text-sm font-semibold text-slate-700">Live Meter Cache</h3>
        <span className="text-xs text-slate-400">— readings not yet billed this period</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {entries.map((e, i) => {
          const m = meta(e.utility_key)
          return (
            <div key={i} className={`rounded-lg border border-slate-200 p-3 ${m.bg}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-semibold text-slate-700">{e.unit_code}</span>
                <span className="text-base">{m.icon}</span>
              </div>
              <p className={`text-lg font-bold ${m.color}`}>
                {e.current_reading.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span className="text-xs font-normal ml-1">{m.unit}</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-1">{e.meter_number}</p>
              <p className="text-[10px] text-slate-400">{e.read_at} · {e.read_by_name || 'system'}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
