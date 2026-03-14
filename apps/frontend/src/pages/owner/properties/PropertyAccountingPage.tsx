import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { invoicesApi } from '@/api/invoices'
import { accountingApi } from '@/api/accounting'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import type { Invoice } from '@/types/invoice'
import type { AccountingSummary } from '@/types/accounting'
import InvoiceDetailSlideOver from '@/components/InvoiceDetailSlideOver'

const PAGE_SIZE = 20

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ready: 'bg-blue-100 text-blue-700',
  sent: 'bg-indigo-100 text-indigo-700',
  partial_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-gray-200 text-gray-500',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export default function PropertyAccountingPage() {
  const { propertyId } = useParams<{ propertyId: string }>()

  const [billingMonth, setBillingMonth] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')  // '' | 'rent' | 'deposit'

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState<AccountingSummary | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load first page + summary whenever filters change
  useEffect(() => {
    if (!propertyId) return
    setPage(1)
    setInvoices([])
    setLoading(true)
    setError(null)
    Promise.all([
      invoicesApi.list({
        property_id: propertyId,
        billing_month: billingMonth || undefined,
        status: statusFilter || undefined,
        invoice_category: categoryFilter || undefined,
        page: 1,
        page_size: PAGE_SIZE,
      }),
      accountingApi.getSummary(billingMonth || undefined, propertyId),
    ])
      .then(([invRes, sumRes]) => {
        setInvoices(invRes.items)
        setTotal(invRes.total)
        setSummary(sumRes)
      })
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [propertyId, billingMonth, statusFilter, categoryFilter])

  const loadMore = useCallback(async () => {
    if (!propertyId || loadingMore) return
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const res = await invoicesApi.list({
        property_id: propertyId,
        billing_month: billingMonth || undefined,
        status: statusFilter || undefined,
        invoice_category: categoryFilter || undefined,
        page: nextPage,
        page_size: PAGE_SIZE,
      })
      setInvoices((prev) => [...prev, ...res.items])
      setPage(nextPage)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoadingMore(false)
    }
  }, [propertyId, billingMonth, statusFilter, categoryFilter, page, loadingMore])

  function handleInvoiceUpdate(updated: Invoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)))
  }

  const hasMore = invoices.length < total

  return (
    <div className="p-6 space-y-6">
      <PropertyBreadcrumb page="Accounting" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Accounting</h1>
          <p className="text-sm text-gray-500 mt-0.5">Invoices and financial overview for this property.</p>
        </div>
        <Link
          to={`/portfolio/properties/${propertyId}/accounting/invoices`}
          className="text-sm text-blue-600 hover:underline font-medium"
        >
          View all invoices →
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Billing Month</label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {billingMonth && (
              <button
                onClick={() => setBillingMonth('')}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
              >
                All ✕
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Statuses</option>
            {['draft', 'ready', 'sent', 'partial_paid', 'paid', 'overdue', 'void'].map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Categories</option>
            <option value="rent">Rent</option>
            <option value="deposit">Deposit</option>
          </select>
        </div>
        {(billingMonth || statusFilter || categoryFilter) && (
          <button
            onClick={() => { setBillingMonth(''); setStatusFilter(''); setCategoryFilter('') }}
            className="text-xs text-gray-400 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 border border-gray-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Summary cards */}
      {!loading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Invoiced</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {summary.total_invoiced.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Collected</p>
            <p className="text-2xl font-bold text-green-600 mt-1">
              {summary.total_collected.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Outstanding</p>
            <p className="text-2xl font-bold text-red-600 mt-1">
              {summary.total_outstanding.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Collection Rate</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">
              {(summary.collection_rate * 100).toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* Invoice list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Invoices {loading ? '…' : `(${invoices.length} of ${total})`}
          </h2>
          <p className="text-xs text-gray-400">Latest first</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Reference</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Unit</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</th>
                <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td>
                </tr>
              )}
              {!loading && invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">No invoices found</td>
                </tr>
              )}
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-blue-600 font-medium">
                    {inv.reference_no}
                    {inv.invoice_category === 'deposit' && (
                      <span className="ml-1.5 text-xs text-purple-600 bg-purple-50 px-1 rounded">deposit</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-900">{inv.tenant_name ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{inv.unit_label ?? inv.unit_id}</td>
                  <td className="px-5 py-3 text-right text-gray-900 font-medium">
                    {inv.total_amount.toLocaleString()}
                  </td>
                  <td className={`px-5 py-3 text-right font-medium ${inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {inv.balance_due.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-600">{inv.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Load more */}
        {!loading && hasMore && (
          <div className="px-5 py-4 border-t border-gray-100 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : `Load more (${total - invoices.length} remaining)`}
            </button>
          </div>
        )}
      </div>

      {selectedId && (
        <InvoiceDetailSlideOver
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdate={handleInvoiceUpdate}
        />
      )}
    </div>
  )
}
