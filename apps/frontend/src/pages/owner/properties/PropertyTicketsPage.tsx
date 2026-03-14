import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { generalTicketsApi } from '@/api/tickets'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import TicketStatusBadge from '@/components/TicketStatusBadge'
import TicketPriorityBadge from '@/components/TicketPriorityBadge'
import CreateTicketModal from '@/components/CreateTicketModal'
import TicketDetailSlideOver from '@/components/TicketDetailSlideOver'
import type { Ticket, TicketCounts } from '@/types/ticket'

const DEFAULT_CATEGORIES = [
  { key: 'maintenance', label: 'Maintenance', enabled: true, default_priority: 'normal' },
  { key: 'utility_reading', label: 'Utility Reading', enabled: true, default_priority: 'normal' },
  { key: 'request', label: 'Request', enabled: true, default_priority: 'normal' },
  { key: 'complaint', label: 'Complaint', enabled: true, default_priority: 'high' },
  { key: 'other', label: 'Other', enabled: true, default_priority: 'normal' },
]

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

export default function PropertyTicketsPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { orgProfile } = useOrgProfile()
  const categories = orgProfile?.ticket_categories ?? DEFAULT_CATEGORIES

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [counts, setCounts] = useState<TicketCounts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const PAGE_SIZE = 20

  async function load() {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const [listRes, countsRes] = await Promise.all([
        generalTicketsApi.list({
          property_id: propertyId,
          status: filterStatus || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        generalTicketsApi.getCounts(propertyId),
      ])
      setTickets(listRes.items)
      setTotal(listRes.total)
      setCounts(countsRes)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId, filterStatus, page])

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('en-KE', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Tickets" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tickets</h1>
          <p className="text-sm text-gray-500 mt-0.5">Maintenance and support requests for this property</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + New Ticket
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard label="Open" value={counts.open} color="text-gray-800" />
          <StatCard label="Assigned" value={counts.assigned} color="text-blue-700" />
          <StatCard label="In Progress" value={counts.in_progress} color="text-yellow-700" />
          <StatCard label="Pending Review" value={counts.pending_review} color="text-purple-700" />
          <StatCard label="Resolved" value={counts.resolved} color="text-green-700" />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <select
          className="input text-sm"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
        >
          <option value="">All Statuses</option>
          {['open', 'assigned', 'in_progress', 'pending_review', 'resolved', 'closed', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={5} className="text-center py-10 text-sm text-gray-400">Loading…</td></tr>
            )}
            {!loading && tickets.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-12">
                  <span className="text-4xl block mb-2">🎫</span>
                  <p className="text-sm text-gray-500">No tickets yet for this property</p>
                </td>
              </tr>
            )}
            {tickets.map((t) => (
              <tr
                key={t.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedId(t.id)}
              >
                <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{t.title}</td>
                <td className="px-4 py-3 text-gray-500 capitalize">{t.category.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3"><TicketPriorityBadge priority={t.priority} /></td>
                <td className="px-4 py-3"><TicketStatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-gray-400">{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{total} total</p>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}
                className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}
                className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && propertyId && (
        <CreateTicketModal
          propertyId={propertyId}
          categories={categories}
          onCreated={() => { setShowCreate(false); load() }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {selectedId && (
        <TicketDetailSlideOver
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => load()}
        />
      )}
    </div>
  )
}
