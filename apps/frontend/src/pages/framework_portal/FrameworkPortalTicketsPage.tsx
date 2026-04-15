import { useEffect, useState } from 'react'
import { listMyTickets } from '@/api/frameworkPortal'

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-500',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-500',
}

export default function FrameworkPortalTicketsPage() {
  const [tickets, setTickets] = useState<Array<{
    id: string
    reference: string
    title: string
    category: string
    status: string
    priority: string
    created_at: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listMyTickets()
      .then(r => setTickets(r.items))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      <h1 className="text-lg font-bold text-gray-900 mb-1">My Tickets</h1>
      <p className="text-xs text-gray-500 mb-4">Support and maintenance tickets assigned to you</p>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <div className="text-4xl mb-3">🎫</div>
          <p className="text-sm text-gray-500">No tickets assigned to you</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 mb-0.5">{t.reference}</div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight">{t.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5 capitalize">{t.category.replace(/_/g, ' ')}</div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-500'}`}>
                    {t.status.replace(/_/g, ' ')}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[t.priority] || 'bg-gray-100 text-gray-500'}`}>
                    {t.priority}
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-400">
                {new Date(t.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
