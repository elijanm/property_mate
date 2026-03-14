import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { invoicesApi } from '@/api/invoices'
import { extractApiError } from '@/utils/apiError'
import type { Invoice, InvoiceCounts, BillingCycleRun } from '@/types/invoice'
import InvoiceDetailSlideOver from '@/components/InvoiceDetailSlideOver'
import GenerateBillingModal from '@/components/GenerateBillingModal'

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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

export default function PrepareInvoicesPage() {
  const { propertyId } = useParams<{ propertyId?: string }>()
  const [billingMonth, setBillingMonth] = useState('')  // empty = all months
  const [sandboxFilter, setSandboxFilter] = useState<boolean | undefined>(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [counts, setCounts] = useState<InvoiceCounts | null>(null)
  const [billingRuns, setBillingRuns] = useState<BillingCycleRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [invData, countData, runsData] = await Promise.all([
        invoicesApi.list({
          billing_month: billingMonth,
          property_id: propertyId,
          sandbox: sandboxFilter,
          status: statusFilter || undefined,
          page: 1,
          page_size: 100,
        }),
        invoicesApi.getCounts({ billing_month: billingMonth, sandbox: sandboxFilter }),
        invoicesApi.getBillingRuns({ billing_month: billingMonth, page: 1, page_size: 10 }),
      ])
      setInvoices(invData.items)
      setCounts(countData)
      setBillingRuns(runsData.items)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [billingMonth, sandboxFilter, statusFilter, propertyId])

  function handleGenerateSuccess(_run: BillingCycleRun) {
    setShowGenerateModal(false)
    loadAll()
  }

  function handleInvoiceUpdate(updated: Invoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)))
  }

  return (
    <>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Prepare Invoices</h1>
            <p className="text-sm text-gray-500 mt-1">Generate and manage monthly invoices</p>
          </div>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span>+</span> Generate Invoices
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
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
                  title="Show all months"
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
          <div className="flex items-center gap-2">
            <input
              id="sandbox-filter"
              type="checkbox"
              checked={sandboxFilter === true}
              onChange={(e) => setSandboxFilter(e.target.checked ? true : false)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="sandbox-filter" className="text-sm text-gray-700">
              Sandbox only
            </label>
          </div>
        </div>

        {/* Stat cards */}
        {counts && (
          <div className="grid grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Draft" value={counts.draft} color="text-gray-700" />
            <StatCard label="Ready" value={counts.ready} color="text-blue-600" />
            <StatCard label="Sent" value={counts.sent} color="text-indigo-600" />
            <StatCard label="Partial" value={counts.partial_paid} color="text-amber-600" />
            <StatCard label="Paid" value={counts.paid} color="text-green-600" />
            <StatCard label="Overdue" value={counts.overdue} color="text-red-600" />
            <StatCard label="Void" value={counts.void} color="text-gray-400" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {/* Invoices table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Invoices {loading ? '…' : `(${invoices.length})`}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Reference</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tenant</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Property / Unit</th>
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
                    <td colSpan={7} className="text-center py-10 text-gray-400">
                      No invoices found{billingMonth ? ` for ${billingMonth}` : ''}
                    </td>
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
                      {inv.sandbox && (
                        <span className="ml-1.5 text-xs text-amber-600 bg-amber-100 px-1 rounded">sandbox</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-900">{inv.tenant_name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {inv.property_name ?? inv.property_id} / {inv.unit_label ?? inv.unit_id}
                    </td>
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
        </div>

        {/* Billing Run History */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            className="w-full px-5 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => setShowRuns(!showRuns)}
          >
            <span>Billing Run History ({billingRuns.length})</span>
            <span className="text-gray-400">{showRuns ? '▲' : '▼'}</span>
          </button>
          {showRuns && (
            <div className="border-t border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500">Started</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-500">Type</th>
                    <th className="text-center px-5 py-2 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500">Created</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500">Skipped</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-500">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {billingRuns.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 text-gray-600">{new Date(r.started_at).toLocaleString()}</td>
                      <td className="px-5 py-2 text-gray-700">
                        {r.run_type}
                        {r.sandbox && <span className="ml-1 text-xs text-amber-600">(sandbox)</span>}
                      </td>
                      <td className="px-5 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.status === 'completed' ? 'bg-green-100 text-green-700' :
                          r.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-5 py-2 text-right text-green-600 font-medium">{r.invoices_created}</td>
                      <td className="px-5 py-2 text-right text-gray-500">{r.invoices_skipped}</td>
                      <td className="px-5 py-2 text-right text-red-600">{r.invoices_failed}</td>
                    </tr>
                  ))}
                  {billingRuns.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-gray-400">No billing runs for this month</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selectedId && (
        <InvoiceDetailSlideOver
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdate={handleInvoiceUpdate}
        />
      )}

      {showGenerateModal && (
        <GenerateBillingModal
          onClose={() => setShowGenerateModal(false)}
          onSuccess={handleGenerateSuccess}
        />
      )}
    </>
  )
}
