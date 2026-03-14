import { useState, useEffect } from 'react'
import { invoicesApi } from '@/api/invoices'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import type { Invoice, InvoiceLineItem, SmartMeterSummary } from '@/types/invoice'
import RecordInvoicePaymentModal from '@/components/RecordInvoicePaymentModal'

const LOCKED_STATUSES = new Set(['sent', 'partial_paid', 'paid', 'overdue'])

interface Props {
  invoiceId: string
  onClose: () => void
  onUpdate?: (invoice: Invoice) => void
}

type Tab = 'line_items' | 'payments' | 'smart_meter' | 'info'

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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function MeterReadingDetail({ li }: { li: InvoiceLineItem }) {
  const [open, setOpen] = useState(false)

  if (li.type !== 'metered_utility' || li.status !== 'confirmed') return null

  const hasReadings = li.current_reading != null || li.previous_reading != null
  const hasTiers = li.tier_breakdown && li.tier_breakdown.length > 0
  if (!hasReadings && !hasTiers) return null

  return (
    <>
      {/* Expand trigger — sits in the description column, full-width */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-0.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {hasTiers ? 'Meter reading & tier calculation' : 'Meter reading details'}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 space-y-3 text-xs">
          {/* Photo */}
          {li.meter_image_url && (
            <img
              src={li.meter_image_url}
              alt="Meter photo"
              className="w-full max-h-36 object-cover rounded-md border border-gray-200"
            />
          )}

          {/* Readings */}
          {hasReadings && (
            <div className="grid grid-cols-3 gap-2">
              {li.previous_reading != null && (
                <div className="bg-white rounded p-2 border border-gray-100 text-center">
                  <p className="text-gray-400 text-[10px] uppercase tracking-wide">Previous</p>
                  <p className="font-mono font-semibold text-gray-800 mt-0.5">{li.previous_reading}</p>
                </div>
              )}
              {li.current_reading != null && (
                <div className="bg-white rounded p-2 border border-gray-100 text-center">
                  <p className="text-gray-400 text-[10px] uppercase tracking-wide">Current</p>
                  <p className="font-mono font-semibold text-gray-800 mt-0.5">{li.current_reading}</p>
                </div>
              )}
              {li.current_reading != null && li.previous_reading != null && (
                <div className="bg-blue-600 rounded p-2 text-center">
                  <p className="text-blue-200 text-[10px] uppercase tracking-wide">Usage</p>
                  <p className="font-mono font-semibold text-white mt-0.5">
                    {(li.current_reading - li.previous_reading).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tier breakdown */}
          {hasTiers && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Tiered Rate Calculation</p>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-gray-100 text-gray-500">
                    <th className="text-left py-1 px-2 font-medium rounded-tl">Band</th>
                    <th className="text-right py-1 px-2 font-medium">Units</th>
                    <th className="text-right py-1 px-2 font-medium">Rate</th>
                    <th className="text-right py-1 px-2 font-medium rounded-tr">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {li.tier_breakdown!.map((b, i) => (
                    <tr key={i} className="border-t border-gray-100 bg-white">
                      <td className="py-1 px-2 text-gray-600">{b.band}</td>
                      <td className="py-1 px-2 text-right font-mono text-gray-700">{b.units.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono text-gray-700">{b.rate.toLocaleString()}</td>
                      <td className="py-1 px-2 text-right font-mono font-semibold text-gray-900">{b.subtotal.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                    <td className="py-1.5 px-2" colSpan={3}>Total</td>
                    <td className="py-1.5 px-2 text-right font-mono">{li.amount.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function SmartMeterPanel({ summary, onApply, applying }: {
  summary?: SmartMeterSummary
  onApply: () => void
  applying: boolean
}) {
  const trendColor = !summary ? '' :
    summary.trend_direction === 'up' ? 'text-red-600' :
    summary.trend_direction === 'down' ? 'text-green-600' : 'text-gray-600'
  const trendIcon = !summary ? '' :
    summary.trend_direction === 'up' ? '↑' :
    summary.trend_direction === 'down' ? '↓' : '→'

  if (!summary) {
    return (
      <div className="text-center py-10 space-y-3">
        <p className="text-4xl">💧</p>
        <p className="text-sm text-gray-500">No smart meter data attached to this invoice.</p>
        <button
          onClick={onApply}
          disabled={applying}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {applying ? 'Attaching…' : 'Attach Smart Meter Data'}
        </button>
      </div>
    )
  }

  const maxUsage = Math.max(...summary.daily_breakdown.map(d => d.total_usage), 0.01)

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <p className="text-[10px] text-blue-500 uppercase tracking-wide font-semibold">Total Usage</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{summary.total_usage.toFixed(1)}</p>
          <p className="text-[10px] text-blue-400">m³ this month</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Daily Avg</p>
          <p className="text-xl font-bold text-gray-700 mt-1">{summary.avg_daily_usage.toFixed(2)}</p>
          <p className="text-[10px] text-gray-400">m³ / day</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Trend</p>
          <p className={`text-xl font-bold mt-1 ${trendColor}`}>{trendIcon} {Math.abs(summary.trend_pct).toFixed(1)}%</p>
          <p className="text-[10px] text-gray-400">vs first half</p>
        </div>
      </div>

      {/* Daily usage bar chart */}
      <div className="bg-white border border-gray-100 rounded-xl p-3">
        <p className="text-xs font-semibold text-gray-600 mb-2">Daily Usage (m³)</p>
        <div className="flex items-end gap-0.5 h-20">
          {summary.daily_breakdown.map((d) => {
            const heightPct = (d.total_usage / maxUsage) * 100
            const isWeekend = new Date(d.date).getDay() % 6 === 0
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center justify-end group relative"
                title={`${d.date}: ${d.total_usage.toFixed(2)} m³`}
              >
                <div
                  className={`w-full rounded-t transition-all ${isWeekend ? 'bg-blue-400' : 'bg-blue-200'} group-hover:bg-blue-500`}
                  style={{ height: `${Math.max(heightPct, 4)}%` }}
                />
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-gray-400">
          <span>{summary.daily_breakdown[0]?.date?.slice(5)}</span>
          <span>{summary.daily_breakdown[Math.floor(summary.daily_breakdown.length / 2)]?.date?.slice(5)}</span>
          <span>{summary.daily_breakdown[summary.daily_breakdown.length - 1]?.date?.slice(5)}</span>
        </div>
      </div>

      {/* Peak day */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-sm">
        <span className="text-amber-700 font-medium">📈 Peak day</span>
        <span className="text-amber-900 font-semibold">{summary.peak_day} — {summary.peak_usage.toFixed(2)} m³</span>
      </div>

      {/* Meter readings */}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Previous Reading</p>
          <p className="font-mono font-semibold text-gray-800 mt-0.5">{summary.previous_reading.toFixed(2)}</p>
        </div>
        <div className="bg-blue-600 rounded-lg p-2 text-center">
          <p className="text-[10px] text-blue-200 uppercase tracking-wide">Current Reading</p>
          <p className="font-mono font-semibold text-white mt-0.5">{summary.latest_reading.toFixed(2)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Readings</p>
          <p className="font-mono font-semibold text-gray-800 mt-0.5">{summary.reading_count}</p>
        </div>
      </div>

      {/* Advice */}
      {summary.advice.length > 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-green-700">💡 Usage Insights</p>
          {summary.advice.map((tip, i) => (
            <p key={i} className="text-xs text-green-800 flex gap-1.5">
              <span className="mt-0.5 flex-shrink-0">•</span>
              <span>{tip}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onApply}
          disabled={applying}
          className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {applying ? 'Refreshing…' : '↻ Refresh Smart Meter Data'}
        </button>
      </div>
    </div>
  )
}

export default function InvoiceDetailSlideOver({ invoiceId, onClose, onUpdate }: Props) {
  const { user } = useAuth()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<unknown[]>([])
  const [tab, setTab] = useState<Tab>('line_items')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingInvoice, setSendingInvoice] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [applyingSmartMeter, setApplyingSmartMeter] = useState(false)

  const isLocked = invoice ? LOCKED_STATUSES.has(invoice.status) : false
  const canEdit = user?.role === 'owner' || user?.role === 'agent' || user?.role === 'superadmin'
  const canSend = canEdit && invoice?.status !== 'void'
  const canVoid = (user?.role === 'owner' || user?.role === 'superadmin') && invoice?.status !== 'void' && invoice?.status !== 'paid'
  const canRecordPayment = canEdit && invoice?.status !== 'void' && invoice?.status !== 'paid'
  const canModify = canEdit && (!isLocked || user?.role === 'owner' || user?.role === 'superadmin')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [inv, pmt] = await Promise.all([
        invoicesApi.get(invoiceId),
        invoicesApi.listPayments(invoiceId),
      ])
      setInvoice(inv)
      setPayments(pmt.items)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [invoiceId])

  async function handleSend() {
    if (!invoice) return
    setSendingInvoice(true)
    try {
      const updated = await invoicesApi.send(invoice.id)
      setInvoice(updated)
      onUpdate?.(updated)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setSendingInvoice(false)
    }
  }

  async function handleVoid() {
    if (!invoice || !window.confirm('Void this invoice? This cannot be undone.')) return
    try {
      await invoicesApi.void(invoice.id)
      await load()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  function handlePaymentSuccess(updated: Invoice) {
    setInvoice(updated)
    setShowPaymentModal(false)
    load()
    onUpdate?.(updated)
  }

  async function handleApplySmartMeter() {
    if (!invoice) return
    setApplyingSmartMeter(true)
    try {
      const result = await invoicesApi.applySmartMeter(invoice.id)
      setInvoice(result.invoice)
      onUpdate?.(result.invoice)
      setTab('smart_meter')
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setApplyingSmartMeter(false)
    }
  }

  async function handleDownloadPdf() {
    if (!invoice) return
    setDownloadingPdf(true)
    try {
      const month = invoice.billing_month.replace('-', '')
      await invoicesApi.downloadPdf(invoice.id, `Invoice_${invoice.reference_no}_${month}.pdf`)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            {invoice ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900">{invoice.reference_no}</h2>
                  <StatusBadge status={invoice.status} />
                  {isLocked && user?.role === 'agent' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                      Locked
                    </span>
                  )}
                  {invoice.invoice_category === 'deposit' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                      Deposit Invoice
                    </span>
                  )}
                  {invoice.sandbox && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                      SANDBOX
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {invoice.invoice_category === 'deposit' ? 'Deposit' : invoice.billing_month} · {invoice.tenant_name} · {invoice.unit_label}
                </p>
              </>
            ) : (
              <div className="h-6 w-40 bg-gray-200 rounded animate-pulse" />
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="flex-1 flex items-center justify-center px-6">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {invoice && !loading && (
          <>
            {/* Financial summary */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Total</p>
                  <p className="font-semibold text-gray-900">KSh {invoice.total_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Paid</p>
                  <p className="font-semibold text-green-600">KSh {invoice.amount_paid.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Balance</p>
                  <p className={`font-semibold ${invoice.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    KSh {invoice.balance_due.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Due</p>
                  <p className="font-semibold text-gray-900">{invoice.due_date}</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-6 border-b border-gray-200 flex gap-4">
              {(['line_items', 'payments', 'smart_meter', 'info'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                    tab === t
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'line_items' ? 'Line Items' :
                   t === 'payments' ? 'Payments' :
                   t === 'smart_meter' ? (
                    <span className="flex items-center gap-1">
                      💧 Smart Meter
                      {invoice.smart_meter_summary && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                      )}
                    </span>
                   ) : 'Info'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {tab === 'line_items' && (
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b">
                        <th className="pb-2">Description</th>
                        <th className="pb-2 text-right">Qty</th>
                        <th className="pb-2 text-right">Unit Price</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoice.line_items.map((li) => (
                        <tr key={li.id} className={li.status === 'pending' ? 'opacity-60' : ''}>
                          <td className="py-2.5 text-gray-900">
                            <div>
                              <span>{li.description}</span>
                              <MeterReadingDetail li={li} />
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-gray-600">{li.quantity}</td>
                          <td className="py-2.5 text-right text-gray-600">
                            {li.unit_price.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right font-medium text-gray-900">
                            {li.amount.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              li.status === 'confirmed'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {li.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={3} className="pt-2 text-right text-sm text-gray-500">Subtotal</td>
                        <td className="pt-2 text-right font-medium">{invoice.subtotal.toLocaleString()}</td>
                        <td />
                      </tr>
                      {invoice.tax_amount > 0 && (
                        <tr>
                          <td colSpan={3} className="text-right text-sm text-gray-500">Tax</td>
                          <td className="text-right font-medium">{invoice.tax_amount.toLocaleString()}</td>
                          <td />
                        </tr>
                      )}
                      <tr>
                        <td colSpan={3} className="text-right font-semibold text-gray-900">Total</td>
                        <td className="text-right font-bold text-gray-900">
                          KSh {invoice.total_amount.toLocaleString()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {tab === 'payments' && (
                <div>
                  {payments.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No payments recorded</p>
                  ) : (
                    <div className="space-y-3">
                      {(payments as Record<string, unknown>[]).map((p) => (
                        <div key={String(p.id)} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              KSh {Number(p.amount).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-500">
                              {String(p.method)} · {String(p.payment_date)}
                            </p>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            {String(p.status)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'smart_meter' && (
                <SmartMeterPanel
                  summary={invoice.smart_meter_summary}
                  onApply={handleApplySmartMeter}
                  applying={applyingSmartMeter}
                />
              )}

              {tab === 'info' && (
                <div className="space-y-3 text-sm">
                  {[
                    ['Property', invoice.property_name],
                    ['Unit', invoice.unit_label],
                    ['Tenant', invoice.tenant_name],
                    ['Lease ID', invoice.lease_id],
                    ['Billing Month', invoice.billing_month],
                    ['Due Date', invoice.due_date],
                    ['Created by', invoice.created_by],
                    ['Sent at', invoice.sent_at ?? '—'],
                    ['Paid at', invoice.paid_at ?? '—'],
                    ['Notes', invoice.notes ?? '—'],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between py-1.5 border-b border-gray-100">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-gray-900 font-medium text-right">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            {canEdit && (
              <div className="px-6 py-4 border-t border-gray-200 flex gap-2 flex-wrap">
                {canRecordPayment && (
                  <button
                    onClick={() => setShowPaymentModal(true)}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Record Payment
                  </button>
                )}
                {canSend && (
                  <button
                    onClick={handleSend}
                    disabled={sendingInvoice}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {sendingInvoice ? 'Sending…' : invoice?.status === 'sent' ? 'Resend Invoice' : 'Send Invoice'}
                  </button>
                )}
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {downloadingPdf ? 'Downloading…' : 'Download PDF'}
                </button>
                {canVoid && canModify && (
                  <button
                    onClick={handleVoid}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Void
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showPaymentModal && invoice && (
        <RecordInvoicePaymentModal
          invoice={invoice}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </>
  )
}
