import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { VacancyDetailData, VacancyDetailRow } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v: number | null) {
  if (v === null) return '—'
  return `KSh ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function daysLabel(d: number) {
  if (d === 0) return 'Today'
  if (d === 1) return '1 day'
  if (d < 30) return `${d} days`
  const months = Math.floor(d / 30)
  const rem = d % 30
  if (rem === 0) return `${months} mo`
  return `${months} mo ${rem}d`
}

function vacancyColor(days: number) {
  if (days < 30)  return { bar: 'bg-amber-400',  text: 'text-amber-600',  badge: 'bg-amber-50 text-amber-700' }
  if (days < 90)  return { bar: 'bg-orange-500', text: 'text-orange-600', badge: 'bg-orange-50 text-orange-700' }
  return             { bar: 'bg-red-500',    text: 'text-red-600',    badge: 'bg-red-50 text-red-700' }
}

// ── Duration heat bar ─────────────────────────────────────────────────────────

function DurationBar({ days, maxDays }: { days: number; maxDays: number }) {
  const pct = maxDays > 0 ? Math.min(100, (days / maxDays) * 100) : 0
  const { bar } = vacancyColor(days)
  return (
    <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Timeline SVG ──────────────────────────────────────────────────────────────

function VacancyTimeline({ rows }: { rows: VacancyDetailRow[] }) {
  if (rows.length === 0) return null
  const maxDays = Math.max(...rows.map(r => r.days_vacant), 1)
  const milestones = [30, 90, 180, 365].filter(m => m <= maxDays * 1.1)

  return (
    <div className="space-y-2">
      {/* Axis */}
      <div className="relative h-6 ml-28 mr-4">
        {milestones.map(m => (
          <div
            key={m}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${(m / maxDays) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <div className="h-3 w-px bg-slate-200" />
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{m}d</span>
          </div>
        ))}
        {/* Zone backgrounds */}
        <div className="absolute inset-y-0 rounded-full overflow-hidden w-full top-0 h-2 mt-1 flex">
          <div className="h-full bg-amber-100" style={{ width: `${Math.min(100, (30 / maxDays) * 100)}%` }} />
          <div className="h-full bg-orange-100" style={{ width: `${Math.min(100, (60 / maxDays) * 100)}%` }} />
          <div className="h-full bg-red-100 flex-1" />
        </div>
      </div>

      {/* Rows */}
      {rows.slice(0, 20).map(row => {
        const pct = Math.min(100, (row.days_vacant / maxDays) * 100)
        const { bar, text } = vacancyColor(row.days_vacant)
        return (
          <div key={row.unit_id} className="flex items-center gap-2">
            <span className="w-24 text-xs font-mono text-slate-600 text-right shrink-0">{row.unit_code}</span>
            <div className="flex-1 relative h-5 bg-slate-50 rounded-full overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full rounded-full ${bar} opacity-80`}
                style={{ width: `${pct}%` }}
              />
              <span className={`absolute left-2 top-0 h-full flex items-center text-[10px] font-medium ${pct > 20 ? 'text-white' : text}`}>
                {daysLabel(row.days_vacant)}
              </span>
            </div>
          </div>
        )
      })}
      {rows.length > 20 && (
        <p className="text-xs text-slate-400 ml-28">+{rows.length - 20} more units — switch to table view to see all</p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewMode = 'visual' | 'table'
type FilterStatus = 'all' | 'vacant' | 'inactive' | 'never-leased' | 'long'

export default function VacancyDetailReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<VacancyDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('visual')
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [filterWing, setFilterWing] = useState('all')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true); setError(null)
    try {
      setData(await reportsApi.getVacancyDetail(propertyId))
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
      const blob = await reportsApi.exportVacancyDetail(propertyId, fmt)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vacancy_detail_${propertyId}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const wings = data ? Array.from(new Set(data.rows.map(r => r.wing))).sort() : []

  const filtered: VacancyDetailRow[] = (data?.rows ?? []).filter(r => {
    if (filter === 'vacant' && r.status !== 'vacant') return false
    if (filter === 'inactive' && r.status !== 'inactive') return false
    if (filter === 'never-leased' && r.ever_leased) return false
    if (filter === 'long' && r.days_vacant < 90) return false
    if (filterWing !== 'all' && r.wing !== filterWing) return false
    return true
  })

  const maxDays = data ? Math.max(...data.rows.map(r => r.days_vacant), 1) : 1

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading vacancy data…</div>
  )
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-red-500 text-sm">{error}</p>
      <button onClick={load} className="text-sm text-blue-600 hover:underline">Retry</button>
    </div>
  )
  if (!data) return null

  const { summary } = data

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
              <h1 className="text-lg font-semibold text-slate-800">Vacancy Detail Report</h1>
              <p className="text-xs text-slate-400">{data.property_name} · Generated {data.generated_at.slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['visual', 'table'] as ViewMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'visual' ? 'Timeline' : 'Table'}
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

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Vacant</p>
            <p className="text-3xl font-bold text-amber-600 mt-1">{summary.total_vacant}</p>
            <p className="text-xs text-slate-400 mt-1">available units</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Inactive</p>
            <p className="text-3xl font-bold text-slate-500 mt-1">{summary.total_inactive}</p>
            <p className="text-xs text-slate-400 mt-1">offline units</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Never Leased</p>
            <p className="text-3xl font-bold text-slate-700 mt-1">{summary.never_leased}</p>
            <p className="text-xs text-slate-400 mt-1">no lease history</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Avg Vacancy</p>
            <p className="text-3xl font-bold text-orange-600 mt-1">
              {summary.avg_days_vacant !== null ? `${summary.avg_days_vacant}d` : '—'}
            </p>
            <p className="text-xs text-slate-400 mt-1">avg days vacant</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Est. Rent Loss</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{fmtMoney(summary.total_estimated_loss)}</p>
            <p className="text-xs text-slate-400 mt-1">cumulative loss</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400" />0–29 days</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-500" />30–89 days</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />90+ days</span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            {([
              { id: 'all',          label: 'All' },
              { id: 'vacant',       label: 'Vacant' },
              { id: 'inactive',     label: 'Inactive' },
              { id: 'never-leased', label: 'Never Leased' },
              { id: 'long',         label: '90+ Days' },
            ] as { id: FilterStatus; label: string }[]).map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  filter === f.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

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

          <span className="ml-auto text-xs text-slate-400">{filtered.length} unit{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-slate-600 font-medium">No vacant units match this filter.</p>
            <p className="text-sm text-slate-400 mt-1">All units are occupied or the selection is empty.</p>
          </div>
        ) : view === 'visual' ? (
          /* Timeline view */
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-5">Vacancy Duration Timeline</h2>
            <VacancyTimeline rows={filtered} />
          </div>
        ) : (
          /* Table view */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-medium">Unit</th>
                    <th className="px-4 py-3 text-left font-medium">Wing / Floor</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Vacant For</th>
                    <th className="px-4 py-3 text-right font-medium">Last Rent</th>
                    <th className="px-4 py-3 text-right font-medium">Est. Loss</th>
                    <th className="px-4 py-3 text-left font-medium">Last Tenant</th>
                    <th className="px-4 py-3 text-left font-medium">Lease Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => {
                    const { badge, text } = vacancyColor(row.days_vacant)
                    return (
                      <tr key={row.unit_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.unit_code}</td>
                        <td className="px-4 py-3 text-slate-500">{row.wing} · F{row.floor}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{row.unit_type}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                            row.status === 'inactive' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <DurationBar days={row.days_vacant} maxDays={maxDays} />
                            <span className={`text-xs font-medium ${text}`}>{daysLabel(row.days_vacant)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(row.last_rent)}</td>
                        <td className="px-4 py-3 text-right">
                          {row.estimated_loss !== null ? (
                            <span className={`text-sm font-semibold ${row.estimated_loss > 50000 ? 'text-red-600' : row.estimated_loss > 20000 ? 'text-orange-600' : 'text-slate-700'}`}>
                              {fmtMoney(row.estimated_loss)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {row.last_tenant_name ? (
                            <div>
                              <p className="text-slate-700 font-medium text-sm">{row.last_tenant_name}</p>
                              {row.last_tenant_phone && <p className="text-xs text-slate-400">{row.last_tenant_phone}</p>}
                            </div>
                          ) : (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${badge}`}>Never leased</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-sm">{row.last_lease_end ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>

                {/* Totals footer */}
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                    <td className="px-4 py-3" colSpan={4}>Total ({filtered.length} units)</td>
                    <td className="px-4 py-3">
                      {filtered.length > 0
                        ? `Avg ${Math.round(filtered.reduce((s, r) => s + r.days_vacant, 0) / filtered.length)}d`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {fmtMoney(filtered.reduce((s, r) => s + (r.estimated_loss ?? 0), 0))}
                    </td>
                    <td className="px-4 py-3" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
