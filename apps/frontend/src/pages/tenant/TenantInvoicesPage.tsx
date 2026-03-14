import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { invoicesApi } from '@/api/invoices'
import { extractApiError } from '@/utils/apiError'
import InvoiceDetailSlideOver from '@/components/InvoiceDetailSlideOver'
import type { Invoice, InvoiceStatus } from '@/types/invoice'

function fmt(n: number) {
  return `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  ready: 'bg-blue-100 text-blue-700',
  sent: 'bg-indigo-100 text-indigo-700',
  partial_paid: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-slate-100 text-slate-500',
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  sent: 'Sent',
  partial_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

export default function TenantInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    invoicesApi
      .list({ page_size: 50 })
      .then((r) => setInvoices(r.items))
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">View and track all your rent and utility invoices.</p>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading invoices…</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
        )}

        {!loading && !error && invoices.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🧾</div>
            <p className="font-medium">No invoices yet</p>
            <p className="text-sm mt-1">Your invoices will appear here once generated.</p>
          </div>
        )}

        {!loading && invoices.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Reference</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Month</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Total</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Balance Due</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedId(inv.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-blue-700">{inv.reference_no}</td>
                    <td className="px-4 py-3 text-gray-700">{inv.billing_month}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{fmt(inv.total_amount)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {inv.balance_due > 0 ? fmt(inv.balance_due) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(inv.due_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <InvoiceDetailSlideOver
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </DashboardLayout>
  )
}
