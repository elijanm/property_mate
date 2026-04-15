import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMyWorkOrders, respondToWorkOrder } from '@/api/frameworkPortal'
import type { WorkOrderSummary } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  assigned: 'bg-blue-100 text-blue-700',
  en_route: 'bg-indigo-100 text-indigo-700',
  pre_inspection: 'bg-purple-100 text-purple-700',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  signed_off: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
}

const SERVICE_LABELS: Record<string, string> = {
  biannual_a: 'PM Service A',
  biannual_b: 'PM Service B',
  quarterly: 'Quarterly Inspection',
  corrective: 'Corrective Maintenance',
  emergency: 'Emergency Response',
}

const TABS = ['All', 'Assigned', 'In Progress', 'Completed']
const TAB_STATUS: Record<string, string | undefined> = {
  All: undefined,
  Assigned: 'assigned',
  'In Progress': 'in_progress',
  Completed: 'completed',
}

export default function FrameworkPortalWorkOrdersPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('All')
  const [items, setItems] = useState<WorkOrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    listMyWorkOrders(TAB_STATUS[tab])
      .then(r => setItems(r.items))
      .finally(() => setLoading(false))
  }, [tab])

  async function handleRespond(wo: WorkOrderSummary, action: 'accept' | 'start') {
    setError('')
    setActioningId(wo.id)
    try {
      const updated = await respondToWorkOrder(wo.id, action)
      setItems(prev => prev.map(w => w.id === wo.id ? updated : w))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Work Orders</h1>
        <p className="text-xs text-gray-500 mt-0.5">Tap a work order to view details and submit pre-inspection</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t ? 'text-white' : 'bg-white border border-gray-200 text-gray-500'
            }`}
            style={tab === t ? { backgroundColor: ACCENT } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mx-4 mt-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      <div className="px-4 py-3 space-y-3">
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔧</div>
            <p className="text-sm text-gray-500">No work orders found</p>
          </div>
        ) : (
          items.map(wo => (
            <div key={wo.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Header row */}
              <button
                onClick={() => navigate(`/framework-portal/work-orders/${wo.id}`)}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 mb-0.5">{wo.work_order_number}</div>
                    <div className="text-sm font-semibold text-gray-900 leading-tight">{wo.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{SERVICE_LABELS[wo.service_type] || wo.service_type}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[wo.status] || 'bg-gray-100 text-gray-600'}`}>
                    {wo.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Sites strip */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {wo.route_stops.map(s => (
                    <span key={s.sequence} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      s.status === 'completed' ? 'bg-green-50 text-green-700' :
                      s.status === 'skipped' ? 'bg-red-50 text-red-400' :
                      'bg-gray-50 text-gray-500'
                    } border border-gray-100`}>
                      {s.site_code}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>📅 {wo.planned_date}</span>
                  <span>·</span>
                  <span>{wo.total_assets} sites</span>
                  {wo.has_pre_inspection && (
                    <>
                      <span>·</span>
                      <span className="text-purple-600">📋 Pre-inspection {wo.pre_inspection_status}</span>
                    </>
                  )}
                </div>
              </button>

              {/* Action strip */}
              {(wo.status === 'assigned' || wo.status === 'en_route') && (
                <div className="border-t border-gray-50 px-4 py-2.5 flex items-center gap-2 bg-gray-50">
                  {wo.status === 'assigned' && (
                    <button
                      onClick={() => handleRespond(wo, 'accept')}
                      disabled={actioningId === wo.id}
                      className="flex-1 py-2 text-xs font-semibold text-white rounded-xl disabled:opacity-50"
                      style={{ backgroundColor: ACCENT }}
                    >
                      {actioningId === wo.id ? 'Accepting…' : '✅ Accept & Go En Route'}
                    </button>
                  )}
                  {wo.status === 'en_route' && (
                    <button
                      onClick={() => handleRespond(wo, 'start')}
                      disabled={actioningId === wo.id}
                      className="flex-1 py-2 text-xs font-semibold text-amber-700 border border-amber-300 rounded-xl hover:bg-amber-50 disabled:opacity-50"
                    >
                      {actioningId === wo.id ? '…' : '🚀 Mark In Progress'}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/framework-portal/work-orders/${wo.id}`)}
                    className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-white"
                  >
                    Details →
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
