import { useState } from 'react'
import { paymentsApi } from '@/api/payments'
import { extractApiError } from '@/utils/apiError'
import { calcProratedRent } from '@/utils/leaseCalculations'
import type { Lease } from '@/types/lease'
import type { Payment, PaymentCategory, PaymentMethod } from '@/types/payment'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'manual', label: 'Manual Entry' },
  { value: 'mpesa_stk', label: 'Mpesa STK Push' },
]

interface CategoryOption {
  id: string
  value: PaymentCategory
  label: string
  description: string
  defaultAmount: number
}

function buildCategories(lease: Lease): CategoryOption[] {
  const utilityDeposit = lease.utility_deposit ?? 0
  const totalDeposit = lease.deposit_amount + utilityDeposit
  const { prorated: proratedRent, days, daysInMonth } = calcProratedRent(lease)
  const totalMoveIn = Math.round((totalDeposit + proratedRent) * 100) / 100
  const fmt = (n: number) => `KES ${n.toLocaleString()}`

  return [
    {
      id: 'full',
      value: 'deposit',
      label: 'Full Amount',
      description: `Deposit + pro-rated rent (${days}/${daysInMonth}d) · ${fmt(totalMoveIn)}`,
      defaultAmount: totalMoveIn,
    },
    {
      id: 'deposit',
      value: 'deposit',
      label: 'Deposit Only',
      description: utilityDeposit > 0
        ? `Security + utility deposits · ${fmt(totalDeposit)}`
        : `Security deposit · ${fmt(lease.deposit_amount)}`,
      defaultAmount: totalDeposit,
    },
    {
      id: 'rent',
      value: 'rent',
      label: 'Rent Only',
      description: `Pro-rated ${days}/${daysInMonth} days · ${fmt(proratedRent)}`,
      defaultAmount: proratedRent,
    },
  ]
}

interface Props {
  lease: Lease
  onClose: () => void
  onSuccess: () => void
}

const today = () => new Date().toISOString().split('T')[0]

export default function RecordPaymentModal({ lease, onClose, onSuccess }: Props) {
  const categories = buildCategories(lease)

  const [selectedId, setSelectedId] = useState<string>(categories[0].id)
  const [category, setCategory] = useState<PaymentCategory>(categories[0].value)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState(String(categories[0].defaultAmount))
  const [paymentDate, setPaymentDate] = useState(today())
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingPayment, setPendingPayment] = useState<Payment | null>(null)

  const isStk = method === 'mpesa_stk'

  function selectCategory(cat: CategoryOption) {
    setSelectedId(cat.id)
    setCategory(cat.value)
    setAmount(String(cat.defaultAmount))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const payment = await paymentsApi.create(lease.id, {
        category,
        method,
        amount: parseFloat(amount),
        payment_date: paymentDate,
        mpesa_phone: isStk ? phone : undefined,
        notes: notes || undefined,
      })
      if (payment.status === 'pending' && isStk) {
        setPendingPayment(payment)
        pollPaymentStatus(payment.id)
      } else {
        onSuccess()
      }
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  function pollPaymentStatus(paymentId: string) {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      try {
        const summary = await paymentsApi.list(lease.id)
        const found = summary.payments.find((p) => p.id === paymentId)
        if (!found || attempts >= 30) { clearInterval(interval); return }
        if (found.status === 'completed') { clearInterval(interval); onSuccess() }
        else if (found.status === 'failed' || found.status === 'cancelled') {
          clearInterval(interval)
          setError('Mpesa payment failed. Please try again.')
          setPendingPayment(null)
        }
      } catch { /* ignore */ }
    }, 3000)
  }

  if (pendingPayment) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Waiting for Mpesa</h3>
          <p className="text-sm text-gray-600">
            A payment prompt has been sent to <strong>{pendingPayment.mpesa_phone}</strong>.
            Please complete it on your phone.
          </p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button className="mt-5 text-sm text-gray-500 underline" onClick={() => { setPendingPayment(null); onClose() }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Record Payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCategory(c)}
                  className={`flex flex-col items-start px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    selectedId === c.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-sm font-medium leading-tight">{c.label}</span>
                  <span className={`text-[11px] mt-1 leading-snug ${selectedId === c.id ? 'text-blue-500' : 'text-gray-400'}`}>
                    {c.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Method */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {isStk && (
              <p className="mt-1 text-xs text-yellow-600 font-medium">Sandbox mode — use test Safaricom number</p>
            )}
          </div>

          {/* Mpesa phone */}
          {isStk && (
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

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (KES)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
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
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Processing…' : isStk ? 'Send STK Push' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
