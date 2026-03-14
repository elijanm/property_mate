import { useEffect, useState } from 'react'
import { generalTicketsApi } from '@/api/tickets'
import { extractApiError } from '@/utils/apiError'
import DashboardLayout from '@/layouts/DashboardLayout'
import TicketStatusBadge from '@/components/TicketStatusBadge'
import TicketPriorityBadge from '@/components/TicketPriorityBadge'
import TicketDetailSlideOver from '@/components/TicketDetailSlideOver'
import type { Ticket } from '@/types/ticket'

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress'],
  assigned: ['in_progress'],
  in_progress: ['pending_review'],
  pending_review: [],
  resolved: [],
  closed: [],
  cancelled: [],
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function ServiceProviderDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await generalTicketsApi.list({ page_size: 50 })
      setTickets(res.items)
      setTotal(res.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function updateStatus(ticket: Ticket, newStatus: string) {
    setUpdatingId(ticket.id)
    try {
      await generalTicketsApi.update(ticket.id, { status: newStatus })
      await load()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Assigned Tickets</h1>
          <p className="text-sm text-gray-500 mt-1">
            View and manage your assigned maintenance jobs.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="max-w-sm mx-auto mt-16 text-center">
            <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔧</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">No Assigned Tickets</h3>
            <p className="text-sm text-gray-500">
              You have no tickets assigned at this time. Check back later.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">{total} ticket{total !== 1 ? 's' : ''}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {tickets.map((t) => {
                const nextStatuses = ALLOWED_TRANSITIONS[t.status] ?? []
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-4 px-4 py-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{t.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">
                        {t.category.replace(/_/g, ' ')} · {t.property_id} · {fmtDate(t.created_at)}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <TicketStatusBadge status={t.status} />
                        <TicketPriorityBadge priority={t.priority} />
                      </div>
                    </div>
                    {nextStatuses.length > 0 && (
                      <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {nextStatuses.map((s) => (
                          <button
                            key={s}
                            disabled={updatingId === t.id}
                            onClick={(e) => { e.stopPropagation(); updateStatus(t, s) }}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {s.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <TicketDetailSlideOver
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => load()}
        />
      )}
    </DashboardLayout>
  )
}
