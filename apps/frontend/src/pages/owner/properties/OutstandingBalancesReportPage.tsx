import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { OutstandingBalancesData, OutstandingBalancesRow } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function daysSeverity(days: number): string {
  if (days === 0) return 'text-gray-500'
  if (days <= 30) return 'text-amber-600'
  if (days <= 60) return 'text-orange-600'
  if (days <= 90) return 'text-red-600'
  return 'text-rose-800 font-bold'
}

function balanceSeverityBar(balance: number, max: number): string {
  const pct = max > 0 ? balance / max : 0
  if (pct >= 0.6) return 'bg-red-500'
  if (pct >= 0.3) return 'bg-orange-400'
  return 'bg-amber-400'
}

function lastPaymentLabel(date: string | null): { text: string; cls: string } {
  if (!date) return { text: 'Never paid', cls: 'text-red-600 font-semibold' }
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
  if (days <= 30) return { text: date, cls: 'text-emerald-600' }
  if (days <= 90) return { text: date, cls: 'text-amber-600' }
  return { text: date, cls: 'text-red-500' }
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data }: { data: OutstandingBalancesData }) {
  const s = data.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <div className="col-span-2 sm:col-span-1 bg-white border-2 border-red-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-red-500 uppercase tracking-wide font-semibold">Total Outstanding</p>
        <p className="mt-1 text-2xl font-bold text-red-600">KSh {fmt(s.total_outstanding)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{s.invoice_count} invoice{s.invoice_count !== 1 ? 's' : ''}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Tenants</p>
        <p className="mt-1 text-xl font-bold text-gray-900">{s.tenant_count}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">with open balance</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Avg Days Overdue</p>
        <p className={`mt-1 text-xl font-bold ${daysSeverity(s.avg_days_overdue)}`}>
          {s.avg_days_overdue}d
        </p>
      </div>
      <div className="bg-white border border-orange-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-orange-500 uppercase tracking-wide font-semibold">Never Paid</p>
        <p className="mt-1 text-xl font-bold text-orange-600">{s.never_paid_count}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">tenant{s.never_paid_count !== 1 ? 's' : ''}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Invoices</p>
        <p className="mt-1 text-xl font-bold text-gray-900">{s.invoice_count}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">unpaid total</p>
      </div>
    </div>
  )
}

// ── Visual Card ───────────────────────────────────────────────────────────────

function VisualCard({ row, maxBalance }: { row: OutstandingBalancesRow; maxBalance: number }) {
  const lp = lastPaymentLabel(row.last_payment_date)
  const barPct = maxBalance > 0 ? Math.max(4, (row.total_balance / maxBalance) * 100) : 4

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="h-1 w-full bg-gray-100">
        <div
          className={`h-full ${balanceSeverityBar(row.total_balance, maxBalance)}`}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <div className="p-4 space-y-3">
        {/* Tenant + unit */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">{row.tenant_name}</p>
            <p className="text-[11px] text-gray-400">{row.unit_code}</p>
          </div>
          <span className={`text-xs font-semibold whitespace-nowrap ${daysSeverity(row.max_days_overdue)}`}>
            {row.max_days_overdue > 0 ? `${row.max_days_overdue}d overdue` : 'Current'}
          </span>
        </div>

        {row.tenant_phone && (
          <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>
        )}

        {/* Balance prominent */}
        <div className="py-2 border-y border-gray-100">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Outstanding Balance</p>
          <p className="text-xl font-bold text-red-600">KSh {fmt(row.total_balance)}</p>
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div>
            <p className="text-gray-400">Invoiced</p>
            <p className="font-medium text-gray-700">KSh {fmt(row.total_invoiced)}</p>
          </div>
          <div>
            <p className="text-gray-400">Paid</p>
            <p className="font-medium text-gray-700">KSh {fmt(row.total_paid)}</p>
          </div>
          <div>
            <p className="text-gray-400">Open invoices</p>
            <p className="font-medium text-gray-700">{row.invoice_count} ({row.overdue_invoice_count} overdue)</p>
          </div>
          <div>
            <p className="text-gray-400">Last payment</p>
            <p className={`font-medium ${lp.cls}`}>{lp.text}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ rows, maxBalance }: { rows: OutstandingBalancesRow[]; maxBalance: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {[
              '#', 'Tenant', 'Unit', 'Invoices', 'Oldest Due', 'Days Overdue',
              'Total Invoiced', 'Paid', 'Balance Due', 'Last Payment',
            ].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => {
            const lp = lastPaymentLabel(row.last_payment_date)
            const barPct = maxBalance > 0 ? Math.max(4, (row.total_balance / maxBalance) * 100) : 4
            return (
              <tr key={row.tenant_id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 font-medium">{i + 1}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900 whitespace-nowrap">{row.tenant_name}</p>
                  {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
                </td>
                <td className="px-4 py-3 font-medium text-gray-700">{row.unit_code}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-gray-700">{row.invoice_count}</span>
                  {row.overdue_invoice_count > 0 && (
                    <span className="ml-1 text-red-500">({row.overdue_invoice_count} overdue)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {row.oldest_due_date ?? '—'}
                </td>
                <td className={`px-4 py-3 text-right ${daysSeverity(row.max_days_overdue)}`}>
                  {row.max_days_overdue > 0 ? `${row.max_days_overdue}d` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(row.total_invoiced)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmt(row.total_paid)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden shrink-0">
                      <div
                        className={`h-full rounded-full ${balanceSeverityBar(row.total_balance, maxBalance)}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="font-bold text-red-600 whitespace-nowrap">
                      {fmt(row.total_balance)}
                    </span>
                  </div>
                </td>
                <td className={`px-4 py-3 whitespace-nowrap ${lp.cls}`}>{lp.text}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-gray-600">
              Total ({rows.length} tenant{rows.length !== 1 ? 's' : ''})
            </td>
            <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">
              {fmt(rows.reduce((a, r) => a + r.total_invoiced, 0))}
            </td>
            <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">
              {fmt(rows.reduce((a, r) => a + r.total_paid, 0))}
            </td>
            <td className="px-4 py-3 text-right text-xs font-bold text-red-600 whitespace-nowrap">
              {fmt(rows.reduce((a, r) => a + r.total_balance, 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'visual'
type FilterMode = 'all' | 'never_paid' | 'overdue_90'

export default function OutstandingBalancesReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<OutstandingBalancesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('table')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      setData(await reportsApi.getOutstandingBalances(propertyId))
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
      const blob = await reportsApi.exportOutstandingBalances(propertyId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `outstanding_balances_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const allRows = data?.rows ?? []
  const maxBalance = allRows.length > 0 ? allRows[0].total_balance : 0 // already sorted desc

  const filteredRows = allRows.filter((r) => {
    if (filter === 'never_paid') return !r.last_payment_date
    if (filter === 'overdue_90') return r.max_days_overdue > 90
    return true
  })

  const FILTERS: { key: FilterMode; label: string }[] = [
    { key: 'all',        label: `All (${allRows.length})` },
    { key: 'never_paid', label: `Never paid (${allRows.filter((r) => !r.last_payment_date).length})` },
    { key: 'overdue_90', label: `90+ days (${allRows.filter((r) => r.max_days_overdue > 90).length})` },
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
            <h1 className="text-2xl font-bold text-gray-900">Outstanding Balances</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · Generated {data?.generated_at.slice(0, 10)} · Sorted by highest balance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Filters */}
      <div className="flex gap-1 mb-5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-5 mb-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-amber-400 inline-block" /> 1–30 days</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-orange-400 inline-block" /> 31–60 days</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-red-500 inline-block" /> 61–90 days</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-rose-800 inline-block" /> 90+ days</span>
        <span className="flex items-center gap-1.5 ml-4 text-emerald-600">● Last payment &lt;30d ago</span>
        <span className="flex items-center gap-1.5 text-amber-600">● 30–90d ago</span>
        <span className="flex items-center gap-1.5 text-red-500">● &gt;90d ago</span>
      </div>

      {/* Content */}
      {filteredRows.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-600 font-medium">No outstanding balances</p>
          <p className="text-sm text-gray-400 mt-1">All tenants are fully settled.</p>
        </div>
      ) : view === 'table' ? (
        <TableView rows={filteredRows} maxBalance={maxBalance} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredRows.map((row) => (
            <VisualCard key={row.tenant_id} row={row} maxBalance={maxBalance} />
          ))}
        </div>
      )}
    </div>
  )
}
