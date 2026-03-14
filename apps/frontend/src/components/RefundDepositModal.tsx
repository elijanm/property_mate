import { useState } from 'react'
import { paymentsApi } from '@/api/payments'
import { extractApiError } from '@/utils/apiError'
import type { PaymentMethod } from '@/types/payment'

interface Props {
  leaseId: string
  depositHeld: number
  totalDeductions: number
  onClose: () => void
  onSuccess: () => void
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'mpesa_b2c', label: 'Mpesa B2C (direct to phone)' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'manual', label: 'Manual / Cash' },
]

export default function RefundDepositModal({
  leaseId,
  depositHeld,
  totalDeductions,
  onClose,
  onSuccess,
}: Props) {
  const netRefund = Math.max(0, depositHeld - totalDeductions)
  const [method, setMethod] = useState<PaymentMethod>('mpesa_b2c')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isB2c = method === 'mpesa_b2c'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await paymentsApi.refund(leaseId, {
        method,
        mpesa_phone: isB2c ? phone : undefined,
        notes: notes || undefined,
      })
      onSuccess()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Refund Deposit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Deposit Held</span>
              <span className="font-medium">{fmt(depositHeld)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total Deductions</span>
              <span className="font-medium text-red-600">- {fmt(totalDeductions)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-2">
              <span className="font-semibold text-gray-900">Net Refund</span>
              <span className="font-bold text-green-700">{fmt(netRefund)}</span>
            </div>
          </div>

          {netRefund <= 0 && (
            <p className="text-sm text-red-600">No refund available — deductions exceed deposit held.</p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Refund Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {isB2c && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone (254...)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="254712345678"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || netRefund <= 0}
              className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Processing…' : `Refund ${fmt(netRefund)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
