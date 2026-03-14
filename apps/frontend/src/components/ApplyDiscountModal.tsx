import React, { useState } from 'react'
import { leasesApi } from '@/api/leases'
import type { Lease, LeaseDiscountPayload } from '@/types/lease'

interface Props {
  lease: Lease
  onClose: () => void
  onUpdated: (lease: Lease) => void
}

export default function ApplyDiscountModal({ lease, onClose, onUpdated }: Props) {
  const [form, setForm] = useState<LeaseDiscountPayload>({
    label: '',
    type: 'fixed',
    value: 0,
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: '',
    note: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const discountedRent = form.type === 'fixed'
    ? Math.max(0, lease.rent_amount - form.value)
    : Math.max(0, lease.rent_amount - (lease.rent_amount * form.value / 100))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload: LeaseDiscountPayload = {
        ...form,
        effective_to: form.effective_to || undefined,
        note: form.note || undefined,
      }
      const updated = await leasesApi.addDiscount(lease.id, payload)
      onUpdated(updated)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Failed to apply discount')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Apply Rent Discount</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Current rent info */}
        <div className="bg-blue-50 rounded-xl p-3 mb-4 text-sm">
          <span className="text-blue-700">Current rent: <strong>KES {lease.rent_amount.toLocaleString()}/mo</strong></span>
          {form.value > 0 && (
            <div className="mt-1 text-green-700">
              After discount: <strong>KES {discountedRent.toLocaleString()}/mo</strong>
              {' '}(saving KES {(lease.rent_amount - discountedRent).toLocaleString()})
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Discount Label *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Loyalty discount, Manager special"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as 'fixed' | 'percentage' }))}
              >
                <option value="fixed">Fixed (KES)</option>
                <option value="percentage">Percentage (%)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.type === 'fixed' ? 'Amount (KES) *' : 'Percentage (%) *'}
              </label>
              <input
                type="number"
                min={0}
                max={form.type === 'percentage' ? 100 : undefined}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.value || ''}
                onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) || 0 }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective From *</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.effective_from}
                onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective To (optional)</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.effective_to || ''}
                onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Note</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              rows={2}
              placeholder="Optional reason for discount"
              value={form.note || ''}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Applying...' : 'Apply Discount'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
