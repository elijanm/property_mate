import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { RentRollData, RentRollRow, RentRollHealth } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, fallback = '—') {
  if (n == null) return fallback
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function healthBadge(health: RentRollHealth) {
  const map: Record<RentRollHealth, { label: string; cls: string }> = {
    healthy:       { label: 'Healthy',        cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    overdue:       { label: 'Overdue',         cls: 'bg-red-100 text-red-700 border-red-200' },
    expiring_soon: { label: 'Expiring Soon',  cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    vacant:        { label: 'Vacant',          cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  }
  const { label, cls } = map[health] ?? map.vacant
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {label}
    </span>
  )
}

function statusDot(status: RentRollRow['status']) {
  return status === 'occupied'
    ? <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
    : <span className="inline-block w-2 h-2 rounded-full bg-gray-300 mr-1.5" />
}

// ── Visual Card View ──────────────────────────────────────────────────────────

function VisualCard({ row }: { row: RentRollRow }) {
  const occupied = row.status === 'occupied'
  return (
    <div className={[
      'rounded-xl border overflow-hidden flex flex-col',
      occupied ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-gray-50',
    ].join(' ')}>
      {/* Top accent */}
      <div className={`h-1 w-full ${
        row.health === 'overdue'       ? 'bg-red-400' :
        row.health === 'expiring_soon' ? 'bg-amber-400' :
        row.health === 'healthy'       ? 'bg-emerald-400' :
                                         'bg-gray-200'
      }`} />

      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Unit header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-sm font-bold text-gray-900">{row.unit_code}</span>
            {row.wing && <span className="ml-1.5 text-xs text-gray-400">{row.wing}</span>}
            {row.floor != null && <span className="ml-1 text-xs text-gray-400">Fl.{row.floor}</span>}
          </div>
          {healthBadge(row.health)}
        </div>

        {row.unit_type && (
          <p className="text-[11px] text-gray-400 -mt-1">{row.unit_type}{row.size ? ` · ${row.size} sqft` : ''}</p>
        )}

        {/* Tenant */}
        {occupied ? (
          <div className="mt-1">
            <p className="text-xs font-semibold text-gray-800">{row.tenant_name ?? '—'}</p>
            {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic mt-1">Vacant unit</p>
        )}

        {/* Financials */}
        {occupied && (
          <div className="mt-auto pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Monthly Rent</p>
              <p className="text-sm font-semibold text-gray-900">KSh {fmt(row.monthly_rent)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Balance Due</p>
              <p className={`text-sm font-semibold ${row.balance_due > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                KSh {fmt(row.balance_due)}
              </p>
            </div>
          </div>
        )}

        {/* Lease dates */}
        {occupied && row.lease_end && (
          <div className="text-[11px] text-gray-400">
            Lease ends {row.lease_end}
            {row.days_remaining != null && (
              <span className="ml-1 font-medium text-gray-500">({row.days_remaining}d left)</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

const TABLE_COLS = [
  { key: 'unit_code',    label: 'Unit' },
  { key: 'wing',         label: 'Wing' },
  { key: 'floor',        label: 'Floor' },
  { key: 'unit_type',    label: 'Type' },
  { key: 'status',       label: 'Status' },
  { key: 'tenant_name',  label: 'Tenant' },
  { key: 'lease_end',    label: 'Lease End' },
  { key: 'days_remaining', label: 'Days Left' },
  { key: 'monthly_rent', label: 'Rent (KSh)' },
  { key: 'balance_due',  label: 'Balance Due (KSh)' },
  { key: 'deposit_held', label: 'Deposit (KSh)' },
  { key: 'health',       label: 'Health' },
]

function TableView({ rows }: { rows: RentRollRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {TABLE_COLS.map((c) => (
              <th
                key={c.key}
                className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.unit_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{row.unit_code}</td>
              <td className="px-4 py-3 text-gray-600">{row.wing || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{row.floor ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{row.unit_type || '—'}</td>
              <td className="px-4 py-3">
                <span className="flex items-center whitespace-nowrap">
                  {statusDot(row.status)}
                  <span className={row.status === 'occupied' ? 'text-emerald-700 font-medium' : 'text-gray-400'}>
                    {row.status === 'occupied' ? 'Occupied' : 'Vacant'}
                  </span>
                </span>
              </td>
              <td className="px-4 py-3 text-gray-800 whitespace-nowrap">{row.tenant_name || '—'}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.lease_end || '—'}</td>
              <td className="px-4 py-3 text-gray-600 text-right">
                {row.days_remaining != null ? row.days_remaining : '—'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">
                {row.monthly_rent != null ? fmt(row.monthly_rent) : '—'}
              </td>
              <td className={`px-4 py-3 text-right font-medium ${row.balance_due > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmt(row.balance_due)}
              </td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(row.deposit_held)}</td>
              <td className="px-4 py-3">{healthBadge(row.health)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: RentRollData }) {
  const s = data.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
      {[
        { label: 'Total Units',   value: s.total_units,       mono: false },
        { label: 'Occupied',      value: s.occupied,          mono: false },
        { label: 'Vacant',        value: s.vacant,            mono: false },
        { label: 'Occupancy',     value: `${s.occupancy_rate}%`, mono: false },
        { label: 'Monthly Rent',  value: `KSh ${fmt(s.total_monthly_rent)}`,  mono: true },
        { label: 'Balance Due',   value: `KSh ${fmt(s.total_balance_due)}`,   mono: true },
        { label: 'Deposits Held', value: `KSh ${fmt(s.total_deposit_held)}`,  mono: true },
      ].map((card) => (
        <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{card.label}</p>
          <p className={`mt-1 text-lg font-bold text-gray-900 ${card.mono ? 'text-base' : ''}`}>{card.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewMode = 'visual' | 'table'

export default function RentRollReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<RentRollData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('visual')
  const [filter, setFilter] = useState<'all' | 'occupied' | 'vacant'>('all')
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await reportsApi.getRentRoll(propertyId)
      setData(result)
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
      const blob = await reportsApi.exportRentRoll(propertyId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rent_roll_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent — export errors are secondary
    } finally {
      setExporting(null)
    }
  }

  const rows = data?.rows ?? []
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter)

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Rent Roll</h1>
        </div>
        <div className="flex items-center justify-center py-32">
          <svg className="animate-spin w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="ml-3 text-sm text-gray-500">Generating report…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1 text-sm">
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
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rent Roll</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · Generated {data?.generated_at.slice(0, 10)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setView('visual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === 'visual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Visual
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Table
            </button>
          </div>

          {/* Export */}
          <button
            onClick={() => handleExport('csv')}
            disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {exporting === 'csv' ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            CSV (Excel)
          </button>
          <button
            onClick={() => handleExport('tsv')}
            disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {exporting === 'tsv' ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            TSV (Legacy)
          </button>

          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            title="Refresh report"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && <SummaryCards data={data} />}

      {/* Status filter */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(['all', 'occupied', 'vacant'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
              filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f === 'all' ? `All (${rows.length})` : f === 'occupied' ? `Occupied (${rows.filter((r) => r.status === 'occupied').length})` : `Vacant (${rows.filter((r) => r.status === 'vacant').length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="text-center py-24 text-gray-400 text-sm">No units found.</div>
      ) : view === 'visual' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((row) => (
            <VisualCard key={row.unit_id} row={row} />
          ))}
        </div>
      ) : (
        <TableView rows={filtered} />
      )}
    </div>
  )
}
