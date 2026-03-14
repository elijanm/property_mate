import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoicesApi } from '@/api/invoices'
import { extractApiError } from '@/utils/apiError'
import { isBillingRunQueued, type BillingCycleRun } from '@/types/invoice'
import type { PricingTier } from '@/types/property'
import { useWebSocket } from '@/context/WebSocketContext'
import { useJobStatus } from '@/hooks/useJobStatus'

interface Props {
  onClose: () => void
  onSuccess: (run: BillingCycleRun) => void
}

interface LineItem {
  id: string
  type: string
  description: string
  utility_key?: string
  quantity: number
  unit_price: number
  amount: number
  tiers?: PricingTier[]
  status: string // "confirmed" | "pending"
  prev_reading: number | null
  prev_read_at: string | null
}

interface PreviewItem {
  lease_id: string
  tenant_id: string
  tenant_name: string
  unit_id: string
  unit_label: string
  property_id: string
  property_name: string
  carried_forward: number
  subtotal: number
  tax_amount: number
  total_amount: number
  due_date: string
  line_items: LineItem[]
}


function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Apply stepped tier pricing to a consumption value. */
function applyTieredRate(tiers: PricingTier[], consumption: number): number {
  if (!tiers.length || consumption <= 0) return 0
  let total = 0
  for (const tier of [...tiers].sort((a, b) => a.from_units - b.from_units)) {
    if (consumption <= tier.from_units) break
    const upper = tier.to_units != null ? Math.min(consumption, tier.to_units) : consumption
    total += (upper - tier.from_units) * tier.rate
  }
  return Math.round(total * 10000) / 10000
}

/** Compute amount for a line item given consumption, respecting tiers. */
function computeAmount(li: LineItem, consumption: number): number {
  return li.tiers?.length ? applyTieredRate(li.tiers, consumption) : consumption * li.unit_price
}

/** Single row in the preview table — expandable */
function PreviewRow({
  item,
  vatEnabled,
}: {
  item: PreviewItem
  vatEnabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  // metered current-reading overrides: lineItem.id → current reading entered
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  // validation errors: lineItem.id → error message
  const [errors, setErrors] = useState<Record<string, string>>({})

  const meteredItems = item.line_items.filter((li) => li.status === 'pending')
  const hasMetered = meteredItems.length > 0
  const hasErrors = Object.keys(errors).length > 0

  // Consumption = current_reading - prev_reading; qty = consumption for rate multiply
  function consumptionFor(li: LineItem, currentReading: number): number {
    if (li.prev_reading !== null && li.prev_reading !== undefined) {
      return Math.max(0, currentReading - li.prev_reading)
    }
    return currentReading
  }

  const totals = Object.keys(overrides).length > 0
    ? (() => {
        let subtotal = 0
        for (const li of item.line_items) {
          if (li.status === 'pending' && overrides[li.id] !== undefined) {
            subtotal += computeAmount(li, consumptionFor(li, overrides[li.id]))
          } else if (li.status === 'confirmed') {
            subtotal += li.amount
          }
        }
        const taxRatio = item.subtotal > 0 ? item.tax_amount / item.subtotal : 0
        const tax_amount = subtotal * taxRatio
        return { subtotal, tax_amount, total_amount: subtotal + tax_amount }
      })()
    : { subtotal: item.subtotal, tax_amount: item.tax_amount, total_amount: item.total_amount }

  function handleCurrentReading(li: LineItem, raw: string) {
    if (raw === '') {
      setOverrides((prev) => { const next = { ...prev }; delete next[li.id]; return next })
      setErrors((prev) => { const next = { ...prev }; delete next[li.id]; return next })
      return
    }
    const val = Number(raw)
    const prev = li.prev_reading
    if (prev !== null && prev !== undefined && val < prev) {
      setErrors((e) => ({ ...e, [li.id]: `Must be ≥ previous reading (${prev})` }))
    } else {
      setErrors((e) => { const next = { ...e }; delete next[li.id]; return next })
    }
    setOverrides((o) => ({ ...o, [li.id]: val }))
  }

  return (
    <>
      <tr
        className={`hover:bg-gray-50 cursor-pointer ${expanded ? 'bg-blue-50' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Property / Unit / Tenant */}
        <td className="px-4 py-3">
          <p className="text-xs font-medium text-gray-800">{item.property_name}</p>
          <p className="text-[11px] font-mono text-blue-600">{item.unit_label}</p>
        </td>
        <td className="px-4 py-3">
          <p className="text-xs text-gray-800">{item.tenant_name}</p>
        </td>
        {/* Prev balance */}
        <td className="px-4 py-3 text-right">
          {item.carried_forward > 0 ? (
            <span className="text-xs font-medium text-red-600">{fmt(item.carried_forward)}</span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>
        {/* Totals */}
        <td className="px-4 py-3 text-right text-xs text-gray-600">{fmt(totals.subtotal)}</td>
        {vatEnabled && (
          <td className="px-4 py-3 text-right text-xs text-gray-400">{fmt(totals.tax_amount)}</td>
        )}
        <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900">
          {fmt(totals.total_amount)}
        </td>
        {/* Metered indicator */}
        <td className="px-4 py-3 text-center">
          {hasMetered ? (
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
              hasErrors ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {hasErrors ? 'Reading Error' : 'Needs Metering'}
            </span>
          ) : (
            <span className="text-[10px] text-gray-300">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-[11px] text-gray-400">{item.due_date}</td>
        <td className="px-4 py-3 text-center text-gray-400 text-xs">{expanded ? '▲' : '▼'}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={vatEnabled ? 9 : 8} className="bg-gray-50 px-6 py-4 border-t border-b border-gray-200">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Line Items</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left pb-1.5 font-medium">Description</th>
                  <th className="text-right pb-1.5 font-medium w-28">Prev Reading</th>
                  <th className="text-center pb-1.5 font-medium w-40">Current Reading</th>
                  <th className="text-right pb-1.5 font-medium w-24">Rate</th>
                  <th className="text-right pb-1.5 font-medium w-28">Amount</th>
                  <th className="text-center pb-1.5 font-medium w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {item.line_items.map((li) => {
                  const isPending = li.status === 'pending'
                  const currentReading = overrides[li.id]
                  const consumption = currentReading !== undefined ? consumptionFor(li, currentReading) : undefined
                  const displayAmount = consumption !== undefined
                    ? computeAmount(li, consumption)
                    : li.amount
                  const isTiered = !!(li.tiers?.length)
                  const errMsg = errors[li.id]

                  return (
                    <tr key={li.id} className={isPending ? 'bg-amber-50' : ''}>
                      <td className="py-2 text-gray-700">{li.description}</td>
                      {/* Prev Reading */}
                      <td className="py-2 text-right">
                        {isPending ? (
                          li.prev_reading !== null && li.prev_reading !== undefined ? (
                            <div>
                              <span className="font-mono text-gray-700">{li.prev_reading}</span>
                              {li.prev_read_at && (
                                <p className="text-[10px] text-gray-400">
                                  {new Date(li.prev_read_at).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic text-[10px]">No prior reading</span>
                          )
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* Current Reading input */}
                      <td className="py-2 text-center">
                        {isPending ? (
                          <div onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              min={li.prev_reading ?? 0}
                              step={0.01}
                              placeholder="Enter reading"
                              value={currentReading ?? ''}
                              onChange={(e) => handleCurrentReading(li, e.target.value)}
                              className={`w-32 border rounded px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 ${
                                errMsg
                                  ? 'border-red-400 bg-red-50 focus:ring-red-400'
                                  : 'border-amber-300 focus:ring-amber-400'
                              }`}
                            />
                            {errMsg && (
                              <p className="text-[10px] text-red-600 mt-0.5">{errMsg}</p>
                            )}
                            {consumption !== undefined && !errMsg && (
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                Consumption: {consumption.toFixed(2)} units
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-600">{li.quantity}</span>
                        )}
                      </td>
                      {/* Rate column */}
                      <td className="py-2 text-right text-gray-500">
                        {isTiered ? (
                          <div className="relative group inline-block">
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium cursor-help select-none">
                              Tiered ▾
                            </span>
                            {/* Hover tooltip */}
                            <div className="absolute right-0 top-full mt-1.5 z-50 hidden group-hover:block
                                            bg-white border border-gray-200 rounded-lg shadow-xl p-2.5 min-w-max">
                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                                Tier Schedule
                              </p>
                              <div className="space-y-1">
                                {consumption !== undefined && !errMsg ? (
                                  // Actual breakdown based on entered consumption
                                  [...li.tiers!]
                                    .sort((a, b) => a.from_units - b.from_units)
                                    .filter((t) => consumption > t.from_units)
                                    .map((t, i) => {
                                      const upper = t.to_units != null ? Math.min(consumption, t.to_units) : consumption
                                      const units = upper - t.from_units
                                      return (
                                        <p key={i} className="text-[11px] font-mono text-gray-700 whitespace-nowrap">
                                          <span className="text-purple-600 font-semibold">
                                            {t.from_units}–{t.to_units ?? '∞'}:
                                          </span>
                                          {' '}{fmt(units)} × {fmt(t.rate)}
                                          <span className="text-gray-500"> = {fmt(units * t.rate)}</span>
                                        </p>
                                      )
                                    })
                                ) : (
                                  // Static schedule (no consumption entered yet)
                                  [...li.tiers!]
                                    .sort((a, b) => a.from_units - b.from_units)
                                    .map((t, i) => {
                                      const bw = t.to_units != null ? t.to_units - t.from_units : null
                                      return (
                                        <p key={i} className="text-[11px] font-mono text-gray-700 whitespace-nowrap">
                                          <span className="text-purple-600 font-semibold">
                                            {t.from_units}–{t.to_units ?? '∞'}:
                                          </span>
                                          {' '}
                                          {bw !== null ? (
                                            <>
                                              {fmt(bw)} × {fmt(t.rate)}
                                              <span className="text-gray-500"> = {fmt(bw * t.rate)}</span>
                                            </>
                                          ) : (
                                            <span className="text-gray-500">{fmt(t.rate)}/unit</span>
                                          )}
                                        </p>
                                      )
                                    })
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          fmt(li.unit_price)
                        )}
                      </td>
                      <td className="py-2 text-right font-medium text-gray-800">
                        {isPending && currentReading === undefined ? (
                          <span className="text-amber-500 italic">pending</span>
                        ) : errMsg ? (
                          <span className="text-red-400 italic">—</span>
                        ) : (
                          fmt(displayAmount)
                        )}
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          isPending ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {isPending ? 'pending' : 'confirmed'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {Object.keys(overrides).length > 0 && !hasErrors && (
              <div className="mt-3 pt-2 border-t border-gray-200 flex justify-between items-center">
                <p className="text-[11px] text-amber-600">
                  Estimated total with dummy readings:
                </p>
                <p className="text-sm font-bold text-gray-900">{fmt(totals.total_amount)}</p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function GenerateBillingModal({ onClose, onSuccess }: Props) {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [billingMonth, setBillingMonth] = useState(defaultMonth)
  const [sandbox, setSandbox] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ run: BillingCycleRun; items: PreviewItem[] } | null>(null)

  // Async job state — set when a non-dry-run is queued
  const [queuedJobId, setQueuedJobId] = useState<string | null>(null)
  const [queuedMonth, setQueuedMonth] = useState<string | null>(null)
  const [completedResult, setCompletedResult] = useState<{
    invoices_created: number
    invoices_skipped: number
    invoices_failed: number
    meter_ticket_ids: string[]
  } | null>(null)

  // Poll job status as resilience fallback if WS drops
  const jobState = useJobStatus(queuedJobId)

  // Also listen for WS billing_run_completed / billing_run_failed events
  const { notifications } = useWebSocket()
  const handledJobIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!queuedJobId) return
    for (const n of notifications) {
      if (handledJobIds.current.has(n.id)) continue
      if (
        (n.type === 'billing_run_completed' || n.type === 'billing_run_failed') &&
        (n.data as Record<string, unknown>)?.job_id === queuedJobId
      ) {
        handledJobIds.current.add(n.id)
        if (n.type === 'billing_run_completed') {
          const d = n.data as Record<string, unknown>
          setCompletedResult({
            invoices_created: (d.invoices_created as number) ?? 0,
            invoices_skipped: (d.invoices_skipped as number) ?? 0,
            invoices_failed: (d.invoices_failed as number) ?? 0,
            meter_ticket_ids: (d.meter_ticket_ids as string[]) ?? [],
          })
          setQueuedJobId(null)
        } else {
          setError('Billing run failed. Check notifications for details.')
          setQueuedJobId(null)
        }
      }
    }
  }, [notifications, queuedJobId])

  // When polling confirms completion
  useEffect(() => {
    if (!queuedJobId) return
    if (jobState.status === 'completed') {
      const r = jobState.result as Record<string, unknown> | undefined
      setCompletedResult({
        invoices_created: (r?.invoices_created as number) ?? 0,
        invoices_skipped: (r?.invoices_skipped as number) ?? 0,
        invoices_failed: (r?.invoices_failed as number) ?? 0,
        meter_ticket_ids: (r?.meter_ticket_ids as string[]) ?? [],
      })
      setQueuedJobId(null)
    } else if (jobState.status === 'failed') {
      setError(jobState.error ?? 'Billing run failed')
      setQueuedJobId(null)
    }
  }, [jobState.status, jobState.error, jobState.result, queuedJobId])

  const displayMonth = sandbox
    ? (() => {
        const [y, m] = billingMonth.split('-').map(Number)
        return `${y - 1}-${String(m).padStart(2, '0')}`
      })()
    : billingMonth

  // Infer whether VAT was applied from any item having tax_amount > 0
  const vatEnabled = preview?.items.some((it) => it.tax_amount > 0) ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await invoicesApi.generate({
        billing_month: billingMonth,
        sandbox,
        dry_run: dryRun,
      })
      if (isBillingRunQueued(result)) {
        // Non-dry-run async path — show job spinner
        setQueuedJobId(result.job_id)
        setQueuedMonth(result.billing_month)
      } else {
        // Dry-run path — always show preview (even if 0 invoices)
        setPreview({ run: result, items: (result.dry_run_preview as unknown as PreviewItem[]) ?? [] })
      }
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateForReal() {
    setPreview(null)
    setError(null)
    setLoading(true)
    try {
      const result = await invoicesApi.generate({
        billing_month: billingMonth,
        sandbox,
        dry_run: false,
      })
      if (isBillingRunQueued(result)) {
        setQueuedJobId(result.job_id)
        setQueuedMonth(result.billing_month)
      } else {
        onSuccess(result)
      }
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !queuedJobId && onClose()}
    >
      <div className={`bg-white rounded-xl shadow-2xl w-full flex flex-col ${preview ? 'max-w-5xl max-h-[90vh]' : 'max-w-md'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">
            {preview ? `Dry Run Preview — ${billingMonth}` : 'Generate Invoices'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            ×
          </button>
        </div>

        {completedResult ? (
          /* ── Job completed ── */
          <div className="p-8 flex flex-col items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-900">Invoices Generated!</p>
              <p className="text-sm text-gray-500 mt-1">
                <strong>{completedResult.invoices_created}</strong> created ·{' '}
                <strong>{completedResult.invoices_skipped}</strong> skipped
                {completedResult.invoices_failed > 0 && (
                  <> · <span className="text-red-600">{completedResult.invoices_failed} failed</span></>
                )}
              </p>
            </div>
            {completedResult.meter_ticket_ids.length > 0 && (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                <p className="font-semibold text-amber-800 mb-1">Meter Readings Required</p>
                <p className="text-amber-700 text-xs mb-3">
                  {completedResult.meter_ticket_ids.length} meter reading ticket
                  {completedResult.meter_ticket_ids.length !== 1 ? 's were' : ' was'} created.
                  Assign a reader and send the capture link to update metered utilities.
                </p>
                <a
                  href="/owner/tickets"
                  onClick={onClose}
                  className="inline-block px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
                >
                  View Meter Reading Tickets →
                </a>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        ) : queuedJobId ? (
          /* ── Async job in progress ── */
          <div className="p-8 flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-900">Generating invoices…</p>
              <p className="text-xs text-gray-500 mt-1">
                Billing month: <span className="font-mono">{queuedMonth}</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                You'll receive a notification when complete. You can close this dialog.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 w-full text-center">{error}</p>
            )}
            <div className="flex gap-3 w-full">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Close (runs in background)
              </button>
            </div>
          </div>
        ) : preview ? (
          /* ── Preview results ── */
          <div className="flex flex-col overflow-hidden">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3 px-6 py-4 shrink-0">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 font-medium">Would Create</p>
                <p className="text-2xl font-bold text-blue-700">{preview.run.invoices_created}</p>
                <p className="text-[10px] text-blue-400 mt-0.5">active leases</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 font-medium">Already Invoiced</p>
                <p className="text-2xl font-bold text-gray-700">{preview.run.invoices_skipped}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">skipped (idempotent)</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${preview.run.invoices_failed > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-500 font-medium">Errors</p>
                <p className={`text-2xl font-bold ${preview.run.invoices_failed > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                  {preview.run.invoices_failed}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">vacant units not billed</p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto flex-1 px-6">
              {preview.items.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-400">
                  No invoices would be generated — no active leases found, or all leases already have invoices for this month.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Property / Unit</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Tenant</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Prev Balance</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Subtotal</th>
                      {vatEnabled && (
                        <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Tax</th>
                      )}
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Total</th>
                      <th className="text-center px-4 py-2 text-xs font-medium text-gray-500 uppercase">Metering</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Due</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.items.map((item, i) => (
                      <PreviewRow key={i} item={item} vatEnabled={vatEnabled} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Failures */}
            {preview.run.failures && preview.run.failures.length > 0 && (
              <div className="mx-6 mt-3 bg-red-50 rounded-lg p-3 shrink-0">
                <p className="text-xs font-semibold text-red-700 mb-1">Failures</p>
                {preview.run.failures.map((f, i) => (
                  <p key={i} className="text-xs text-red-600">
                    {String((f as Record<string, unknown>).lease_id)}: {String((f as Record<string, unknown>).error)}
                  </p>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 space-y-3">
              <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                Dry run — no invoices were saved. Click rows to expand line items and enter dummy meter readings to simulate totals.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleGenerateForReal}
                  disabled={loading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Generating…' : 'Generate for Real'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Month</label>
              <input
                type="month"
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              {sandbox && (
                <p className="text-xs text-amber-600 mt-1">
                  Sandbox: effective month will be <strong>{displayMonth}</strong>
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <input
                id="sandbox"
                type="checkbox"
                checked={sandbox}
                onChange={(e) => setSandbox(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-amber-600"
              />
              <div>
                <label htmlFor="sandbox" className="text-sm font-medium text-amber-800">Sandbox Mode</label>
                <p className="text-xs text-amber-600">Invoices tagged sandbox, excluded from financial reports</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <input
                id="dry_run"
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <div>
                <label htmlFor="dry_run" className="text-sm font-medium text-blue-800">Dry Run (Preview only)</label>
                <p className="text-xs text-blue-600">
                  Calculates invoices without saving — shows a preview with editable metered readings
                </p>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Generating…' : dryRun ? 'Preview' : 'Generate'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
