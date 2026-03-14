import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { generalTicketsApi } from '@/api/tickets'
import { leasesApi } from '@/api/leases'
import { extractApiError } from '@/utils/apiError'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import TicketStatusBadge from '@/components/TicketStatusBadge'
import TicketPriorityBadge from '@/components/TicketPriorityBadge'
import TicketDetailSlideOver from '@/components/TicketDetailSlideOver'
import CreateTicketModal from '@/components/CreateTicketModal'
import type { Ticket } from '@/types/ticket'
import type { TicketCategoryConfig } from '@/types/org'

const DEFAULT_CATEGORIES: TicketCategoryConfig[] = [
  { key: 'maintenance', label: 'Maintenance', enabled: true, default_priority: 'normal' },
  { key: 'request', label: 'Request', enabled: true, default_priority: 'normal' },
  { key: 'complaint', label: 'Complaint', enabled: true, default_priority: 'normal' },
]

export default function TenantTicketsPage() {
  const { orgProfile } = useOrgProfile()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [propertyId, setPropertyId] = useState<string>('')

  const categories = orgProfile?.ticket_categories ?? DEFAULT_CATEGORIES

  function load() {
    setLoading(true)
    generalTicketsApi
      .list({ page_size: 50 })
      .then((r) => setTickets(r.items))
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Fetch active lease to get property_id for ticket creation
    leasesApi
      .myLeases()
      .then((r) => {
        const active = r.items.find((l) => !['expired', 'terminated'].includes(l.status)) ?? r.items[0]
        if (active) setPropertyId(active.property_id)
      })
      .catch(() => {})
  }, [])

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Tickets</h1>
            <p className="text-sm text-gray-500 mt-0.5">Maintenance requests and other issues.</p>
          </div>
          {propertyId && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Request
            </button>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading tickets…</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🎫</div>
            <p className="font-medium">No tickets yet</p>
            <p className="text-sm mt-1">Submit a maintenance request or report an issue.</p>
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Priority</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{t.title}</td>
                    <td className="px-4 py-3 text-gray-500 capitalize text-xs">{t.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <TicketPriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <TicketStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId && (
        <TicketDetailSlideOver
          ticketId={selectedId}
          onClose={() => { setSelectedId(null); load() }}
        />
      )}

      {showCreate && propertyId && (
        <CreateTicketModal
          propertyId={propertyId}
          categories={categories}
          onCreated={() => { setShowCreate(false); load() }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </DashboardLayout>
  )
}
