import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import {
  listListings,
  createListing,
  publishListing,
  deleteListing,
} from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type { VendorListing, VendorListingStatus } from '@/types/vendor'

const STATUS_BADGE: Record<VendorListingStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
  awarded: 'bg-blue-100 text-blue-700',
}

function CreateListingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    service_category: '',
    requirements: '',
    application_fee: '0',
    contract_duration_months: '12',
    contract_template: '',
    deadline: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createListing({
        ...form,
        application_fee: parseFloat(form.application_fee) || 0,
        contract_duration_months: parseInt(form.contract_duration_months) || 12,
        deadline: form.deadline || undefined,
        contract_template: form.contract_template || undefined,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">Create Listing / Tender</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
            <textarea
              required
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Service Category *</label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. plumbing"
                value={form.service_category}
                onChange={(e) => setForm((f) => ({ ...f, service_category: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Application Fee (KES)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.application_fee}
                onChange={(e) => setForm((f) => ({ ...f, application_fee: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contract Duration (months)</label>
              <input
                type="number"
                min="1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.contract_duration_months}
                onChange={(e) => setForm((f) => ({ ...f, contract_duration_months: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deadline</label>
              <input
                type="datetime-local"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Requirements</label>
            <textarea
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="List what documents / qualifications are required"
              value={form.requirements}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contract Template (Markdown)</label>
            <textarea
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="Paste the contract text here. Approved vendors will be asked to sign this."
              value={form.contract_template}
              onChange={(e) => setForm((f) => ({ ...f, contract_template: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VendorListingsPage() {
  const [listings, setListings] = useState<VendorListing[]>([])
  const [_total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listListings({ status: filterStatus || undefined })
      setListings(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterStatus])

  async function handlePublish(id: string) {
    try { await publishListing(id); load() } catch {}
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this listing?')) return
    try { await deleteListing(id); load() } catch {}
  }

  function fmtDate(s?: string) {
    if (!s) return '—'
    return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vendor Listings</h1>
            <p className="text-sm text-gray-500 mt-0.5">Publish tenders and manage vendor applications</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + New Listing
          </button>
        </div>

        <div className="flex gap-3">
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="awarded">Awarded</option>
          </select>
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

        <div className="grid gap-4">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
          ) : listings.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">No listings found.</p>
          ) : (
            listings.map((l) => (
              <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{l.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[l.status]}`}>
                        {l.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">{l.description}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{l.service_category}</span>
                      {l.deadline && <span>Deadline: {fmtDate(l.deadline)}</span>}
                      {l.application_fee > 0 && <span>Fee: KES {l.application_fee.toLocaleString()}</span>}
                      {l.contract_duration_months && <span>{l.contract_duration_months} months</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    {l.status === 'draft' && (
                      <button
                        onClick={() => handlePublish(l.id)}
                        className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                      >
                        Publish
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(l.id)}
                      className="px-3 py-1.5 text-red-600 border border-red-200 text-xs rounded-lg hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreate && (
        <CreateListingModal onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </DashboardLayout>
  )
}
