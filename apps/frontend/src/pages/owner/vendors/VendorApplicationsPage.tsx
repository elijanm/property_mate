import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { listApplications, approveApplication, rejectApplication } from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type { VendorApplication, VendorApplicationStatus } from '@/types/vendor'

const STATUS_BADGE: Record<VendorApplicationStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-500',
}

function RejectModal({
  applicationId,
  onClose,
  onRejected,
}: {
  applicationId: string
  onClose: () => void
  onRejected: () => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await rejectApplication(applicationId, reason)
      onRejected()
      onClose()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Reject Application</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rejection Reason *</label>
            <textarea
              required
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VendorApplicationsPage() {
  const [applications, setApplications] = useState<VendorApplication[]>([])
  const [_total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await listApplications({ status: filterStatus || undefined })
      setApplications(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterStatus])

  async function handleApprove(id: string) {
    setActionLoading(id)
    try { await approveApplication(id); load() } catch {}
    setActionLoading(null)
  }

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Applications</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review and act on vendor applications</p>
        </div>

        <div className="flex gap-3">
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Applicant</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Categories</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Submitted</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : applications.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No applications found.</td></tr>
              ) : (
                applications.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.company_name}</p>
                      <p className="text-xs text-gray-400">{a.contact_name} · {a.contact_email}</p>
                      {a.cover_letter && (
                        <p className="text-xs text-gray-500 mt-1 italic line-clamp-1">{a.cover_letter}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {a.service_categories.slice(0, 3).map((c) => (
                          <span key={c} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status]}`}>
                        {a.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(a.created_at)}</td>
                    <td className="px-4 py-3">
                      {a.status === 'submitted' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(a.id)}
                            disabled={actionLoading === a.id}
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectTarget(a.id)}
                            className="px-3 py-1 text-red-600 border border-red-200 text-xs rounded hover:bg-red-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {a.rejection_reason && (
                        <p className="text-xs text-red-500 mt-1">{a.rejection_reason}</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rejectTarget && (
        <RejectModal
          applicationId={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={load}
        />
      )}
    </DashboardLayout>
  )
}
