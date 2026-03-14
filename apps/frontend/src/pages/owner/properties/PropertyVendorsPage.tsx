import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import {
  listVendors,
  getVendorCounts,
  createVendor,
  approveVendor,
  suspendVendor,
  sendVendorInvite,
  getVendorTickets,
  addVendorRating,
  listListings,
  createListing,
  publishListing,
  deleteListing,
  listApplications,
  approveApplication,
  rejectApplication,
} from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type {
  VendorProfile,
  VendorCounts,
  VendorStatus,
  VendorListing,
  VendorListingStatus,
  VendorApplication,
  VendorApplicationStatus,
} from '@/types/vendor'

// ── Shared badges ──────────────────────────────────────────────────────────────

const VENDOR_STATUS_BADGE: Record<VendorStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  inactive: 'bg-gray-100 text-gray-500',
  rejected: 'bg-red-100 text-red-600',
}

const LISTING_STATUS_BADGE: Record<VendorListingStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
  awarded: 'bg-blue-100 text-blue-700',
}

const APP_STATUS_BADGE: Record<VendorApplicationStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-500',
}

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Vendor Detail Slide-Over ───────────────────────────────────────────────────

function VendorSlideOver({
  vendor,
  onClose,
  onRefresh,
}: {
  vendor: VendorProfile
  onClose: () => void
  onRefresh: () => void
}) {
  const [tickets, setTickets] = useState<any[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [tab, setTab] = useState<'profile' | 'tickets'>('profile')
  const [actionLoading, setActionLoading] = useState(false)
  const [ratingStars, setRatingStars] = useState(5)
  const [ratingReview, setRatingReview] = useState('')
  const [showRating, setShowRating] = useState(false)

  useEffect(() => {
    if (tab === 'tickets') {
      setTicketsLoading(true)
      getVendorTickets(vendor.id).then((r) => setTickets(r.items ?? [])).finally(() => setTicketsLoading(false))
    }
  }, [tab])

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
    try { await addVendorRating(vendor.id, { stars: ratingStars, review: ratingReview }); setShowRating(false); onRefresh() } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-xl h-full shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{vendor.company_name}</h2>
            <p className="text-sm text-gray-500">{vendor.contact_email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl mt-1">✕</button>
        </div>

        {/* Actions */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VENDOR_STATUS_BADGE[vendor.status]}`}>
            {vendor.status.replace('_', ' ')}
          </span>
          {vendor.rating_count > 0 && (
            <span className="text-xs text-gray-500">
              <span className="text-yellow-400">★</span> {vendor.rating_avg.toFixed(1)} ({vendor.rating_count})
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {vendor.status !== 'approved' && (
              <button onClick={handleApprove} disabled={actionLoading} className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50">Approve</button>
            )}
            {vendor.status !== 'suspended' && (
              <button onClick={handleSuspend} disabled={actionLoading} className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50">Suspend</button>
            )}
            <button onClick={handleSendInvite} disabled={actionLoading} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">Send Invite</button>
            <button onClick={() => setShowRating(!showRating)} className="px-3 py-1.5 bg-yellow-500 text-white text-xs rounded-lg hover:bg-yellow-600">Rate</button>
          </div>
        </div>

        {showRating && (
          <div className="px-6 py-3 border-b border-gray-100 bg-yellow-50 flex items-center gap-3">
            <select value={ratingStars} onChange={(e) => setRatingStars(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm">
              {[1,2,3,4,5].map((s) => <option key={s} value={s}>{s} ★</option>)}
            </select>
            <input className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" placeholder="Review (optional)" value={ratingReview} onChange={(e) => setRatingReview(e.target.value)} />
            <button onClick={handleRate} className="px-3 py-1 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600">Submit</button>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 border-b border-gray-100 flex gap-4">
          {(['profile', 'tickets'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={['py-3 text-sm font-medium border-b-2 transition-colors capitalize', tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'].join(' ')}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {tab === 'profile' && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Contact', vendor.contact_name],
                ['Phone', vendor.contact_phone ?? '—'],
                ['Company Type', vendor.company_type],
                ['Reg. No.', vendor.registration_number ?? '—'],
                ['KRA PIN', vendor.tax_pin ?? '—'],
                ['Website', vendor.website ?? '—'],
                ['Address', vendor.address ?? '—'],
                ['Service Areas', vendor.service_areas.join(', ') || '—'],
                ['Categories', vendor.service_categories.join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="font-medium text-gray-900">{value}</p>
                </div>
              ))}
              {vendor.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                  <p className="text-gray-700">{vendor.notes}</p>
                </div>
              )}
            </div>
          )}
          {tab === 'tickets' && (
            ticketsLoading ? <p className="text-sm text-gray-400">Loading…</p> :
            tickets.length === 0 ? <p className="text-sm text-gray-400">No tickets assigned.</p> :
            tickets.map((t: any) => (
              <div key={t.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-900">{t.title}</p>
                <p className="text-gray-400 text-xs mt-0.5">{t.status} · {t.category}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Create Vendor Modal ───────────────────────────────────────────────────────

function CreateVendorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ company_name: '', contact_name: '', contact_email: '', contact_phone: '', company_type: 'individual', service_categories: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createVendor({ ...form, service_categories: form.service_categories ? form.service_categories.split(',').map((s) => s.trim()).filter(Boolean) : [] })
      onCreated(); onClose()
    } catch (err) { setError(extractApiError(err).message) }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company Name *</label>
              <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.company_name} onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name *</label>
              <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
              <input required type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company Type</label>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.company_type} onChange={(e) => setForm((f) => ({ ...f, company_type: e.target.value }))}>
                <option value="individual">Individual</option>
                <option value="sole_proprietor">Sole Proprietor</option>
                <option value="partnership">Partnership</option>
                <option value="limited_company">Limited Company</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Categories (comma-separated)</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="plumbing, electrical" value={form.service_categories} onChange={(e) => setForm((f) => ({ ...f, service_categories: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Create Listing Modal ──────────────────────────────────────────────────────

function CreateListingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', service_category: '', application_fee: '0', contract_duration_months: '12', contract_template: '', deadline: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createListing({ ...form, application_fee: parseFloat(form.application_fee) || 0, contract_duration_months: parseInt(form.contract_duration_months) || 12, deadline: form.deadline || undefined, contract_template: form.contract_template || undefined })
      onCreated(); onClose()
    } catch (err) { setError(extractApiError(err).message) }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">New Listing / Tender</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
            <textarea required rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Service Category *</label>
              <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. plumbing" value={form.service_category} onChange={(e) => setForm((f) => ({ ...f, service_category: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Application Fee (KES)</label>
              <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.application_fee} onChange={(e) => setForm((f) => ({ ...f, application_fee: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contract Duration (months)</label>
              <input type="number" min="1" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.contract_duration_months} onChange={(e) => setForm((f) => ({ ...f, contract_duration_months: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deadline</label>
              <input type="datetime-local" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contract Template (Markdown)</label>
            <textarea rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-y" placeholder="Paste contract text here…" value={form.contract_template} onChange={(e) => setForm((f) => ({ ...f, contract_template: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Reject Application Modal ──────────────────────────────────────────────────

function RejectModal({ applicationId, onClose, onRejected }: { applicationId: string; onClose: () => void; onRejected: () => void }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try { await rejectApplication(applicationId, reason); onRejected(); onClose() } catch {}
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Reject Application</h2>
          <button onClick={onClose} className="text-gray-400">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <textarea required rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" placeholder="Reason for rejection…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
              {submitting ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Vendors tab ───────────────────────────────────────────────────────────────

function VendorsTab() {
  const [vendors, setVendors] = useState<VendorProfile[]>([])
  const [counts, setCounts] = useState<VendorCounts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<VendorProfile | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [listRes, countsRes] = await Promise.all([
        listVendors({ status: filterStatus || undefined, search: search || undefined, page, page_size: PAGE_SIZE }),
        getVendorCounts(),
      ])
      setVendors(listRes.items)
      setTotal(listRes.total)
      setCounts(countsRes)
    } catch (err) { setError(extractApiError(err).message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [filterStatus, search, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-52" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}>
            <option value="">All Statuses</option>
            {(['draft','pending_review','approved','suspended','inactive','rejected'] as VendorStatus[]).map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">+ Add Vendor</button>
      </div>

      {counts && (
        <div className="grid grid-cols-4 gap-3">
          {[['Total', counts.total, 'text-gray-900'], ['Active', counts.approved, 'text-green-600'], ['Pending', counts.pending_review, 'text-yellow-600'], ['Suspended', counts.suspended, 'text-red-600']].map(([label, val, color]) => (
            <div key={label as string} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Contact</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Categories</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No vendors found.</td></tr>
            ) : vendors.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(v)}>
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
                    {v.service_categories.length > 2 && <span className="text-gray-400 text-xs">+{v.service_categories.length - 2}</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VENDOR_STATUS_BADGE[v.status]}`}>{v.status.replace('_', ' ')}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {v.rating_count > 0 ? <><span className="text-yellow-400">★</span> {v.rating_avg.toFixed(1)}</> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40">Previous</button>
          <span className="px-3 py-1.5 text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-40">Next</button>
        </div>
      )}

      {showCreate && <CreateVendorModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {selected && <VendorSlideOver vendor={selected} onClose={() => setSelected(null)} onRefresh={load} />}
    </div>
  )
}

// ── Listings tab ──────────────────────────────────────────────────────────────

function ListingsTab() {
  const { user } = useAuth()
  const [listings, setListings] = useState<VendorListing[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const appBase = window.location.origin
  const directoryUrl = `${appBase}/listings?org_id=${user?.org_id ?? ''}`

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  async function load() {
    setLoading(true)
    try {
      const res = await listListings({ status: filterStatus || undefined })
      setListings(res.items)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [filterStatus])

  async function handlePublish(id: string) {
    try { await publishListing(id); load() } catch {}
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this listing?')) return
    try { await deleteListing(id); load() } catch {}
  }

  return (
    <div className="space-y-4">
      {/* Public directory share banner */}
      <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <span className="text-blue-600 text-sm flex-1">
          Public listings directory: <span className="font-mono text-xs">{directoryUrl}</span>
        </span>
        <button
          onClick={() => copyToClipboard(directoryUrl, 'directory')}
          className="shrink-0 text-sm text-blue-700 font-medium hover:text-blue-900"
        >
          {copied === 'directory' ? '✓ Copied' : 'Copy link'}
        </button>
        <a
          href={directoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-sm text-blue-700 font-medium hover:text-blue-900"
        >
          Preview ↗
        </a>
      </div>

      <div className="flex items-center justify-between">
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {(['draft','open','closed','awarded'] as VendorListingStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">+ New Listing</button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : listings.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No listings yet.</p>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{l.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LISTING_STATUS_BADGE[l.status]}`}>{l.status}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{l.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{l.service_category}</span>
                    {l.deadline && <span>Deadline: {fmtDate(l.deadline)}</span>}
                    {l.application_fee > 0 && <span>Fee: KES {l.application_fee.toLocaleString()}</span>}
                    {l.contract_duration_months && <span>{l.contract_duration_months} months</span>}
                  </div>
                </div>
                <div className="flex gap-2 ml-4 items-start">
                  {l.status === 'open' && (
                    <button
                      onClick={() => copyToClipboard(`${appBase}/apply/${l.id}`, l.id)}
                      className="px-3 py-1.5 text-blue-600 border border-blue-200 text-xs rounded-lg hover:bg-blue-50"
                    >
                      {copied === l.id ? '✓ Copied' : 'Copy link'}
                    </button>
                  )}
                  {l.status === 'draft' && (
                    <button onClick={() => handlePublish(l.id)} className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">Publish</button>
                  )}
                  <button onClick={() => handleDelete(l.id)} className="px-3 py-1.5 text-red-600 border border-red-200 text-xs rounded-lg hover:bg-red-50">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateListingModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  )
}

// ── Applications tab ──────────────────────────────────────────────────────────

function ApplicationsTab() {
  const [applications, setApplications] = useState<VendorApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await listApplications({ status: filterStatus || undefined })
      setApplications(res.items)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [filterStatus])

  async function handleApprove(id: string) {
    setActionLoading(id)
    try { await approveApplication(id); load() } catch {}
    setActionLoading(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {(['submitted','under_review','approved','rejected','withdrawn'] as VendorApplicationStatus[]).map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Applicant</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Categories</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : applications.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No applications.</td></tr>
            ) : applications.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{a.company_name}</p>
                  <p className="text-xs text-gray-400">{a.contact_name} · {a.contact_email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.service_categories.slice(0, 2).map((c) => (
                      <span key={c} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${APP_STATUS_BADGE[a.status]}`}>
                    {a.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(a.created_at)}</td>
                <td className="px-4 py-3">
                  {a.status === 'submitted' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(a.id)} disabled={actionLoading === a.id} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50">Approve</button>
                      <button onClick={() => setRejectTarget(a.id)} className="px-3 py-1 text-red-600 border border-red-200 text-xs rounded hover:bg-red-50">Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectTarget && <RejectModal applicationId={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={load} />}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'vendors' | 'listings' | 'applications'

export default function PropertyVendorsPage() {
  const [tab, setTab] = useState<Tab>('vendors')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'vendors', label: 'Vendors' },
    { key: 'listings', label: 'Listings / Tenders' },
    { key: 'applications', label: 'Applications' },
  ]

  return (
    <div className="p-6 space-y-6">
      <PropertyBreadcrumb page="Vendors" />
      <div>
        <h2 className="text-xl font-bold text-gray-900">Vendor Management</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage service providers, tenders, and applications</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'pb-3 text-sm font-medium border-b-2 transition-colors',
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vendors' && <VendorsTab />}
      {tab === 'listings' && <ListingsTab />}
      {tab === 'applications' && <ApplicationsTab />}
    </div>
  )
}
