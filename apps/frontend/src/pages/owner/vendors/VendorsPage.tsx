import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import {
  listVendors,
  getVendorCounts,
  createVendor,
  approveVendor,
  suspendVendor,
  sendVendorInvite,
  getVendorTickets,
  addVendorRating,
} from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type { VendorProfile, VendorCounts, VendorStatus } from '@/types/vendor'

const STATUS_BADGE: Record<VendorStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  inactive: 'bg-gray-100 text-gray-500',
  rejected: 'bg-red-100 text-red-600',
}

function StatusBadge({ status }: { status: VendorStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[status]}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function StarRating({ avg, count }: { avg: number; count: number }) {
  return (
    <span className="text-xs text-gray-600 flex items-center gap-1">
      <span className="text-yellow-400">★</span>
      {count > 0 ? `${avg.toFixed(1)} (${count})` : 'No ratings'}
    </span>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function CreateVendorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    company_name: '', contact_name: '', contact_email: '', contact_phone: '',
    company_type: 'individual', service_categories: '',
    address: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createVendor({
        ...form,
        service_categories: form.service_categories
          ? form.service_categories.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company Name *</label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.company_name}
                onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name *</label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contact Email *</label>
              <input
                required
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company Type</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.company_type}
                onChange={(e) => setForm((f) => ({ ...f, company_type: e.target.value }))}
              >
                <option value="individual">Individual</option>
                <option value="sole_proprietor">Sole Proprietor</option>
                <option value="partnership">Partnership</option>
                <option value="limited_company">Limited Company</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Service Categories (comma-separated)</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="plumbing, electrical"
                value={form.service_categories}
                onChange={(e) => setForm((f) => ({ ...f, service_categories: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
              {submitting ? 'Creating…' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VendorDetailSlideOver({
  vendor,
  onClose,
  onRefresh,
}: {
  vendor: VendorProfile
  onClose: () => void
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'profile' | 'tickets' | 'contracts' | 'audit'>('profile')
  const [tickets, setTickets] = useState<any[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [ratingStars, setRatingStars] = useState(5)
  const [ratingReview, setRatingReview] = useState('')
  const [showRating, setShowRating] = useState(false)

  useEffect(() => {
    if (tab === 'tickets') loadTickets()
  }, [tab])

  async function loadTickets() {
    setTicketsLoading(true)
    try {
      const res = await getVendorTickets(vendor.id)
      setTickets(res.items ?? [])
    } catch {}
    setTicketsLoading(false)
  }

  async function handleApprove() {
    setActionLoading(true)
    try { await approveVendor(vendor.id); onRefresh(); onClose() } catch {}
    setActionLoading(false)
  }

  async function handleSuspend() {
    setActionLoading(true)
    try { await suspendVendor(vendor.id); onRefresh(); onClose() } catch {}
    setActionLoading(false)
  }

  async function handleSendInvite() {
    setActionLoading(true)
    try { await sendVendorInvite(vendor.id); onRefresh() } catch {}
    setActionLoading(false)
  }

  async function handleRate() {
    try {
      await addVendorRating(vendor.id, { stars: ratingStars, review: ratingReview })
      setShowRating(false)
      onRefresh()
    } catch {}
  }

  const tabs = ['profile', 'tickets', 'contracts', 'audit'] as const

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{vendor.company_name}</h2>
            <p className="text-sm text-gray-500">{vendor.contact_email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl mt-1">✕</button>
        </div>

        {/* Action bar */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <StatusBadge status={vendor.status} />
          <StarRating avg={vendor.rating_avg} count={vendor.rating_count} />
          <div className="ml-auto flex gap-2">
            {vendor.status !== 'approved' && (
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Approve
              </button>
            )}
            {vendor.status !== 'suspended' && (
              <button
                onClick={handleSuspend}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Suspend
              </button>
            )}
            <button
              onClick={handleSendInvite}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Send Invite
            </button>
            <button
              onClick={() => setShowRating(!showRating)}
              className="px-3 py-1.5 bg-yellow-500 text-white text-xs rounded-lg hover:bg-yellow-600"
            >
              Rate
            </button>
          </div>
        </div>

        {/* Rating form */}
        {showRating && (
          <div className="px-6 py-3 border-b border-gray-100 bg-yellow-50 flex items-center gap-3">
            <select
              value={ratingStars}
              onChange={(e) => setRatingStars(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {[1,2,3,4,5].map((s) => <option key={s} value={s}>{s} ★</option>)}
            </select>
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Review (optional)"
              value={ratingReview}
              onChange={(e) => setRatingReview(e.target.value)}
            />
            <button onClick={handleRate} className="px-3 py-1 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600">
              Submit
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 border-b border-gray-100 flex gap-4">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'py-3 text-sm font-medium border-b-2 transition-colors capitalize',
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'profile' && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Contact Name', vendor.contact_name],
                ['Email', vendor.contact_email],
                ['Phone', vendor.contact_phone ?? '—'],
                ['Company Type', vendor.company_type],
                ['Registration No.', vendor.registration_number ?? '—'],
                ['Tax PIN', vendor.tax_pin ?? '—'],
                ['Website', vendor.website ?? '—'],
                ['Address', vendor.address ?? '—'],
                ['Service Areas', vendor.service_areas.join(', ') || '—'],
                ['Categories', vendor.service_categories.join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="font-medium text-gray-900">{value}</p>
                </div>
              ))}
              {vendor.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500 mb-0.5">Notes</p>
                  <p className="text-gray-900">{vendor.notes}</p>
                </div>
              )}
            </div>
          )}

          {tab === 'tickets' && (
            ticketsLoading ? (
              <p className="text-sm text-gray-500">Loading tickets…</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-gray-500">No tickets assigned to this vendor.</p>
            ) : (
              <div className="space-y-2">
                {tickets.map((t: any) => (
                  <div key={t.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-900">{t.title}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{t.status} · {t.category}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'contracts' && (
            <p className="text-sm text-gray-500">Use "Send Contract" from the admin action to create and send contracts.</p>
          )}

          {tab === 'audit' && (
            <p className="text-sm text-gray-500">Audit trail is stored in the backend. View from API.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<VendorProfile[]>([])
  const [counts, setCounts] = useState<VendorCounts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState<VendorProfile | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory] = useState('')
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [listRes, countsRes] = await Promise.all([
        listVendors({ status: filterStatus || undefined, category: filterCategory || undefined, search: search || undefined, page, page_size: PAGE_SIZE }),
        getVendorCounts(),
      ])
      setVendors(listRes.items)
      setTotal(listRes.total)
      setCounts(countsRes)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterStatus, filterCategory, search, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage service providers and contractors</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + Add Vendor
          </button>
        </div>

        {/* Stat cards */}
        {counts && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total" value={counts.total} color="text-gray-900" />
            <StatCard label="Active" value={counts.approved} color="text-green-600" />
            <StatCard label="Pending Review" value={counts.pending_review} color="text-yellow-600" />
            <StatCard label="Suspended" value={counts.suspended} color="text-red-600" />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search company / contact…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_review">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Error */}
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Company</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Categories</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No vendors found.</td></tr>
              ) : (
                vendors.map((v) => (
                  <tr
                    key={v.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedVendor(v)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{v.company_name}</p>
                      {v.trading_name && <p className="text-xs text-gray-400">{v.trading_name}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{v.contact_name}</p>
                      <p className="text-xs text-gray-400">{v.contact_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {v.service_categories.slice(0, 2).map((c) => (
                          <span key={c} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">{c}</span>
                        ))}
                        {v.service_categories.length > 2 && (
                          <span className="text-gray-400 text-xs">+{v.service_categories.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                    <td className="px-4 py-3"><StarRating avg={v.rating_avg} count={v.rating_count} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateVendorModal onClose={() => setShowCreate(false)} onCreated={load} />
      )}

      {selectedVendor && (
        <VendorDetailSlideOver
          vendor={selectedVendor}
          onClose={() => setSelectedVendor(null)}
          onRefresh={load}
        />
      )}
    </DashboardLayout>
  )
}
