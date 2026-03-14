import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { OccupancyData, OccupancyUnitRow, OccupancyWingRow, OccupancyFloorRow, OccupancyTypeRow } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtRate(v: number | null) {
  return v === null ? '—' : `${v}%`
}

function fmtRent(v: number | null) {
  if (v === null) return '—'
  return `KSh ${v.toLocaleString()}`
}

function statusColor(status: string) {
  switch (status) {
    case 'occupied': return 'bg-emerald-100 text-emerald-700'
    case 'booked':   return 'bg-blue-100 text-blue-700'
    case 'reserved': return 'bg-indigo-100 text-indigo-700'
    case 'vacant':   return 'bg-slate-100 text-slate-600'
    case 'inactive': return 'bg-red-100 text-red-600'
    default:         return 'bg-gray-100 text-gray-600'
  }
}

function rateColor(rate: number | null) {
  if (rate === null) return '#94a3b8'
  if (rate >= 90) return '#10b981'
  if (rate >= 70) return '#f59e0b'
  return '#ef4444'
}

// ── Breakdown bar chart ───────────────────────────────────────────────────────

function BreakdownBar({ label, occupied, vacant, total, rate }: {
  label: string
  occupied: number
  vacant: number
  total: number
  rate: number | null
}) {
  const occPct = total > 0 ? (occupied / total) * 100 : 0
  const vacPct = total > 0 ? (vacant / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-sm text-slate-600 truncate text-right shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${occPct}%` }}
          title={`Occupied: ${occupied}`}
        />
        <div
          className="h-full bg-slate-200 transition-all"
          style={{ width: `${vacPct}%` }}
          title={`Vacant: ${vacant}`}
        />
      </div>
      <span className="w-12 text-xs font-medium text-right" style={{ color: rateColor(rate) }}>
        {fmtRate(rate)}
      </span>
      <span className="w-8 text-xs text-slate-400 text-right">{total}</span>
    </div>
  )
}

// ── Circular rate badge ───────────────────────────────────────────────────────

function RateBadge({ rate }: { rate: number | null }) {
  const r = 30, circ = 2 * Math.PI * r
  const fill = rate !== null ? ((rate / 100) * circ) : 0
  const color = rateColor(rate)
  return (
    <div className="relative inline-flex items-center justify-center w-20 h-20">
      <svg className="absolute" width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none"
          stroke={color} strokeWidth="7"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="text-lg font-bold" style={{ color }}>
        {rate !== null ? `${rate}%` : '—'}
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewMode = 'overview' | 'table'
type FilterStatus = 'all' | 'occupied' | 'vacant' | 'other'

export default function OccupancyReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<OccupancyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('overview')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterWing, setFilterWing] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true); setError(null)
    try {
      setData(await reportsApi.getOccupancy(propertyId))
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const exportReport = async (format: 'csv' | 'tsv') => {
    if (!propertyId) return
    setExporting(true)
    try {
      const blob = await reportsApi.exportOccupancy(propertyId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `occupancy_${propertyId}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  // ── derived filters ──────────────────────────────────────────────────────────

  const wings = data ? Array.from(new Set(data.rows.map(r => r.wing))).sort() : []
  const types = data ? Array.from(new Set(data.rows.map(r => r.unit_type))).sort() : []

  const filteredRows: OccupancyUnitRow[] = (data?.rows ?? []).filter(r => {
    if (filterStatus === 'occupied' && !['occupied', 'booked', 'reserved'].includes(r.status)) return false
    if (filterStatus === 'vacant' && r.status !== 'vacant') return false
    if (filterStatus === 'other' && ['occupied', 'booked', 'reserved', 'vacant'].includes(r.status)) return false
    if (filterWing !== 'all' && r.wing !== filterWing) return false
    if (filterType !== 'all' && r.unit_type !== filterType) return false
    return true
  })

  // ── loading / error states ───────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading occupancy data…</div>
  )
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-red-500 text-sm">{error}</p>
      <button onClick={load} className="text-sm text-blue-600 hover:underline">Retry</button>
    </div>
  )
  if (!data) return null

  const { summary, by_wing, by_floor, by_type } = data

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Occupancy Report</h1>
              <p className="text-xs text-slate-400">{data.property_name} · Generated {data.generated_at.slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['overview', 'table'] as ViewMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'overview' ? 'Overview' : 'Unit table'}
                </button>
              ))}
            </div>

            <button
              onClick={load}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              title="Refresh"
            >
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

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Units', value: summary.total_units, sub: 'across all wings', color: 'slate' },
            { label: 'Occupied', value: summary.occupied, sub: 'actively leased', color: 'emerald' },
            { label: 'Vacant', value: summary.vacant, sub: 'available', color: 'amber' },
            { label: 'Occupancy Rate', value: fmtRate(summary.occupancy_rate), sub: 'overall', color: 'blue' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{c.label}</p>
              <p className={`text-3xl font-bold mt-1 ${
                c.color === 'emerald' ? 'text-emerald-600' :
                c.color === 'amber'   ? 'text-amber-600'  :
                c.color === 'blue'    ? 'text-blue-600'   : 'text-slate-800'
              }`}>{c.value}</p>
              <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {view === 'overview' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* By Wing */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">By Wing</h2>
                <div className="flex gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200" />Vacant</span>
                </div>
              </div>
              {by_wing.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No wing data</p>
              ) : (
                <div className="space-y-3">
                  {(by_wing as OccupancyWingRow[]).map(w => (
                    <BreakdownBar key={w.wing} label={w.wing} occupied={w.occupied} vacant={w.vacant} total={w.total} rate={w.occupancy_rate} />
                  ))}
                </div>
              )}
            </div>

            {/* By Floor */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">By Floor</h2>
                <span className="text-xs text-slate-400">{by_floor.length} floor{by_floor.length !== 1 ? 's' : ''}</span>
              </div>
              {by_floor.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No floor data</p>
              ) : (
                <div className="space-y-3">
                  {(by_floor as OccupancyFloorRow[]).map(f => (
                    <BreakdownBar key={f.floor} label={`Floor ${f.floor}`} occupied={f.occupied} vacant={f.vacant} total={f.total} rate={f.occupancy_rate} />
                  ))}
                </div>
              )}
            </div>

            {/* By Unit Type */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">By Unit Type</h2>
                <span className="text-xs text-slate-400">{by_type.length} type{by_type.length !== 1 ? 's' : ''}</span>
              </div>
              {by_type.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No type data</p>
              ) : (
                <div className="space-y-3">
                  {(by_type as OccupancyTypeRow[]).map(t => (
                    <BreakdownBar key={t.unit_type} label={t.unit_type} occupied={t.occupied} vacant={t.vacant} total={t.total} rate={t.occupancy_rate} />
                  ))}
                </div>
              )}
            </div>

            {/* Occupancy rate dials row */}
            <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Rate by Wing</h2>
              {by_wing.length === 0 ? (
                <p className="text-sm text-slate-400">No wings configured.</p>
              ) : (
                <div className="flex flex-wrap gap-6">
                  {(by_wing as OccupancyWingRow[]).map(w => (
                    <div key={w.wing} className="flex flex-col items-center gap-1">
                      <RateBadge rate={w.occupancy_rate} />
                      <p className="text-xs font-medium text-slate-600">Wing {w.wing}</p>
                      <p className="text-xs text-slate-400">{w.occupied}/{w.total} units</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status breakdown donut (SVG) */}
            <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Status Breakdown</h2>
              <StatusDonut rows={data.rows} total={summary.total_units} />
            </div>
          </div>
        ) : (
          /* Table view */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Filters */}
            <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-center">
              {/* Status filter */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {([
                  { id: 'all',      label: 'All' },
                  { id: 'occupied', label: 'Occupied' },
                  { id: 'vacant',   label: 'Vacant' },
                  { id: 'other',    label: 'Other' },
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

              {/* Wing */}
              {wings.length > 1 && (
                <select
                  value={filterWing}
                  onChange={e => setFilterWing(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="all">All wings</option>
                  {wings.map(w => <option key={w} value={w}>Wing {w}</option>)}
                </select>
              )}

              {/* Type */}
              {types.length > 1 && (
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="all">All types</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}

              <span className="ml-auto text-xs text-slate-400">{filteredRows.length} units</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Unit</th>
                    <th className="px-4 py-3 text-left font-medium">Wing</th>
                    <th className="px-4 py-3 text-left font-medium">Floor</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Size</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Tenant</th>
                    <th className="px-4 py-3 text-right font-medium">Rent / mo</th>
                    <th className="px-4 py-3 text-left font-medium">Lease End</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">No units match the current filters.</td>
                    </tr>
                  ) : filteredRows.map(row => (
                    <tr key={row.unit_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.unit_code}</td>
                      <td className="px-4 py-3 text-slate-600">{row.wing}</td>
                      <td className="px-4 py-3 text-slate-600">{row.floor}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{row.unit_type}</td>
                      <td className="px-4 py-3 text-slate-500">{row.size ? `${row.size} m²` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColor(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.tenant_name ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmtRent(row.monthly_rent)}</td>
                      <td className="px-4 py-3 text-slate-500">{row.lease_end ?? <span className="text-slate-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Status donut SVG ─────────────────────────────────────────────────────────

function StatusDonut({ rows, total }: { rows: OccupancyUnitRow[], total: number }) {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1

  const palette: Record<string, string> = {
    occupied: '#10b981',
    booked:   '#3b82f6',
    reserved: '#8b5cf6',
    vacant:   '#e2e8f0',
    inactive: '#f87171',
  }

  const segments = Object.entries(counts).map(([s, c]) => ({
    status: s, count: c, color: palette[s] ?? '#94a3b8',
    pct: total > 0 ? Math.round(c / total * 100) : 0,
  })).sort((a, b) => b.count - a.count)

  const r = 60, cx = 80, cy = 80, circ = 2 * Math.PI * r
  let offset = 0
  const arcs = segments.map(seg => {
    const dash = (seg.count / total) * circ
    const arc = { ...seg, dash, offset }
    offset += dash
    return arc
  })

  return (
    <div className="flex flex-wrap items-center gap-8">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
        ) : arcs.map((arc, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth="18"
            strokeDasharray={`${arc.dash} ${circ - arc.dash}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="text-xl font-bold fill-slate-800" fontSize="20" fontWeight="700">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400" fontSize="11">total units</text>
      </svg>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {segments.map(seg => (
          <div key={seg.status} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-sm text-slate-600 capitalize">{seg.status}</span>
            <span className="text-sm font-medium text-slate-800">{seg.count}</span>
            <span className="text-xs text-slate-400">({seg.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}
