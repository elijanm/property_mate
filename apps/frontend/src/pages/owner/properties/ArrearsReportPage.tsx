import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { ArrearsData, ArrearsRow, ArrearsBucket } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const BUCKET_META: Record<ArrearsBucket, { label: string; color: string; bg: string; border: string; bar: string }> = {
  '0_30':    { label: '0–30 days',   color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200',  bar: 'bg-amber-400' },
  '31_60':   { label: '31–60 days',  color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', bar: 'bg-orange-500' },
  '61_90':   { label: '61–90 days',  color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    bar: 'bg-red-500' },
  '90_plus': { label: '90+ days',    color: 'text-rose-900',   bg: 'bg-rose-100',  border: 'border-rose-300',   bar: 'bg-rose-700' },
}

function BucketBadge({ bucket }: { bucket: ArrearsBucket }) {
  const m = BUCKET_META[bucket]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.bg} ${m.color} ${m.border}`}>
      {m.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready:        'bg-blue-100 text-blue-700 border-blue-200',
    sent:         'bg-purple-100 text-purple-700 border-purple-200',
    partial_paid: 'bg-amber-100 text-amber-700 border-amber-200',
    overdue:      'bg-red-100 text-red-700 border-red-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${map[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Summary Section ───────────────────────────────────────────────────────────

function ArrearsSummary({ data }: { data: ArrearsData }) {
  const s = data.summary
  const total = s.total_overdue_balance || 1 // avoid div/0

  const buckets: { key: ArrearsBucket; label: string }[] = [
    { key: '0_30',    label: '0–30 days' },
    { key: '31_60',   label: '31–60 days' },
    { key: '61_90',   label: '61–90 days' },
    { key: '90_plus', label: '90+ days' },
  ]

  return (
    <div className="mb-6 space-y-4">
      {/* Top stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="col-span-2 sm:col-span-1 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Total Outstanding</p>
          <p className="mt-1 text-xl font-bold text-red-600">KSh {fmt(s.total_overdue_balance)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{s.total_invoices} invoice{s.total_invoices !== 1 ? 's' : ''}</p>
        </div>
        {buckets.map(({ key, label }) => {
          const b = s[`bucket_${key}` as keyof typeof s] as { count: number; balance: number }
          const m = BUCKET_META[key]
          const pct = s.total_overdue_balance > 0 ? Math.round((b.balance / total) * 100) : 0
          return (
            <div key={key} className={`bg-white border rounded-xl p-4 shadow-sm ${m.border}`}>
              <p className={`text-[10px] uppercase tracking-wide font-semibold ${m.color}`}>{label}</p>
              <p className="mt-1 text-base font-bold text-gray-900">KSh {fmt(b.balance)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{b.count} invoice{b.count !== 1 ? 's' : ''} · {pct}%</p>
            </div>
          )
        })}
      </div>

      {/* Aging bar */}
      {s.total_overdue_balance > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">Aging breakdown</p>
          <div className="flex rounded-full overflow-hidden h-2.5 w-full bg-gray-100">
            {buckets.map(({ key }) => {
              const b = s[`bucket_${key}` as keyof typeof s] as { count: number; balance: number }
              const pct = (b.balance / total) * 100
              return pct > 0 ? (
                <div
                  key={key}
                  className={`${BUCKET_META[key].bar} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${BUCKET_META[key].label}: KSh ${fmt(b.balance)}`}
                />
              ) : null
            })}
          </div>
          <div className="flex gap-4 mt-1.5 flex-wrap">
            {buckets.map(({ key }) => (
              <span key={key} className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className={`w-2 h-2 rounded-full ${BUCKET_META[key].bar}`} />
                {BUCKET_META[key].label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Table View ────────────────────────────────────────────────────────────────

function TableView({ rows }: { rows: ArrearsRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {[
              'Reference', 'Unit', 'Tenant', 'Billing Month', 'Due Date',
              'Days Overdue', 'Age Bucket', 'Total (KSh)', 'Paid (KSh)', 'Balance (KSh)', 'Status',
            ].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.invoice_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{row.reference_no}</td>
              <td className="px-4 py-3 font-semibold text-gray-900">{row.unit_code}</td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-800 whitespace-nowrap">{row.tenant_name}</p>
                {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
              </td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.billing_month}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.due_date ?? '—'}</td>
              <td className="px-4 py-3 text-right">
                <span className={`font-bold ${
                  row.days_overdue > 90 ? 'text-rose-700' :
                  row.days_overdue > 60 ? 'text-red-600' :
                  row.days_overdue > 30 ? 'text-orange-600' : 'text-amber-600'
                }`}>
                  {row.days_overdue}d
                </span>
              </td>
              <td className="px-4 py-3"><BucketBadge bucket={row.bucket} /></td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(row.total_amount)}</td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(row.amount_paid)}</td>
              <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(row.balance_due)}</td>
              <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={7} className="px-4 py-3 text-xs font-semibold text-gray-600">
              Total ({rows.length} invoice{rows.length !== 1 ? 's' : ''})
            </td>
            <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">
              {fmt(rows.reduce((a, r) => a + r.total_amount, 0))}
            </td>
            <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">
              {fmt(rows.reduce((a, r) => a + r.amount_paid, 0))}
            </td>
            <td className="px-4 py-3 text-right text-xs font-bold text-red-600">
              {fmt(rows.reduce((a, r) => a + r.balance_due, 0))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Visual Cards ──────────────────────────────────────────────────────────────

function VisualCard({ row }: { row: ArrearsRow }) {
  const m = BUCKET_META[row.bucket]
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <div className={`h-1 w-full ${m.bar}`} />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">{row.unit_code}</p>
            <p className="text-[11px] text-gray-400 font-mono">{row.reference_no}</p>
          </div>
          <BucketBadge bucket={row.bucket} />
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-800">{row.tenant_name}</p>
          {row.tenant_phone && <p className="text-[11px] text-gray-400">{row.tenant_phone}</p>}
        </div>

        <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 mt-auto">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Balance Due</p>
            <p className="text-base font-bold text-red-600">KSh {fmt(row.balance_due)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Days Overdue</p>
            <p className={`text-base font-bold ${m.color}`}>{row.days_overdue}d</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">{row.billing_month}</span>
          <StatusBadge status={row.status} />
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type BucketFilter = 'all' | ArrearsBucket

export default function ArrearsReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<ArrearsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'visual'>('table')
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all')
  const [exporting, setExporting] = useState<'csv' | 'tsv' | null>(null)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      setData(await reportsApi.getArrears(propertyId))
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
      const blob = await reportsApi.exportArrears(propertyId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `arrears_${data?.property_name?.replace(/\s+/g, '_') ?? propertyId}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const allRows = data?.rows ?? []
  const rows = bucketFilter === 'all' ? allRows : allRows.filter((r) => r.bucket === bucketFilter)

  const BUCKET_FILTERS: { key: BucketFilter; label: string }[] = [
    { key: 'all',     label: `All (${allRows.length})` },
    { key: '0_30',    label: `0–30d (${allRows.filter((r) => r.bucket === '0_30').length})` },
    { key: '31_60',   label: `31–60d (${allRows.filter((r) => r.bucket === '31_60').length})` },
    { key: '61_90',   label: `61–90d (${allRows.filter((r) => r.bucket === '61_90').length})` },
    { key: '90_plus', label: `90+d (${allRows.filter((r) => r.bucket === '90_plus').length})` },
  ]

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
            <h1 className="text-2xl font-bold text-gray-900">Arrears Report</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.property_name} · Generated {data?.generated_at.slice(0, 10)}
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
          {(['csv', 'tsv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleExport(fmt)}
              disabled={!!exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting === fmt ? (
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              {fmt.toUpperCase()}{fmt === 'csv' ? ' (Excel)' : ' (Legacy)'}
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
      {data && <ArrearsSummary data={data} />}

      {/* Bucket filter tabs */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {BUCKET_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setBucketFilter(key)}
            className={[
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              bucketFilter === key
                ? key === 'all'
                  ? 'bg-gray-900 text-white'
                  : `${BUCKET_META[key as ArrearsBucket].bar} text-white`
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-600 font-medium">No arrears found</p>
          <p className="text-sm text-gray-400 mt-1">All invoices for this property are settled.</p>
        </div>
      ) : view === 'table' ? (
        <TableView rows={rows} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rows.map((row) => <VisualCard key={row.invoice_id} row={row} />)}
        </div>
      )}
    </div>
  )
}
