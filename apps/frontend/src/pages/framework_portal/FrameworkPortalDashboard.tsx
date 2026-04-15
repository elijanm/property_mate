import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { listMyWorkOrders, getMyMetrics } from '@/api/frameworkPortal'
import type { VendorProfile, WorkOrderSummary, PortalMetrics } from '@/api/frameworkPortal'

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
  quarterly: 'Quarterly',
  corrective: 'Corrective',
  emergency: 'Emergency',
}

export default function FrameworkPortalDashboard() {
  const { vendor } = useOutletContext<{ vendor: VendorProfile | null }>()
  const navigate = useNavigate()

  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([])
  const [metrics, setMetrics] = useState<PortalMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listMyWorkOrders(),
      getMyMetrics(),
    ]).then(([wo, m]) => {
      setWorkOrders(wo.items.slice(0, 5))
      setMetrics(m)
    }).finally(() => setLoading(false))
  }, [])

  const active = workOrders.filter(wo => !['completed', 'signed_off', 'cancelled'].includes(wo.status))

  return (
    <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
      {/* Greeting */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">
          Hello, {vendor?.contact_name?.split(' ')[0] || 'there'} 👋
        </h1>
        <p className="text-sm text-gray-500">{vendor?.name}</p>
      </div>

      {/* KYC checklist — show if not active */}
      {vendor && vendor.status !== 'active' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="font-semibold text-amber-800 text-sm">Complete Your Profile</div>
          <KycCheck done={vendor.has_selfie} label="Selfie photo" />
          <KycCheck done={vendor.has_id_front} label="ID front" />
          <KycCheck done={vendor.has_id_back} label="ID back" />
          <KycCheck done={vendor.has_badge} label="Contractor badge issued" />
          {(!vendor.has_selfie || !vendor.has_id_front || !vendor.has_id_back) && (
            <button
              onClick={() => navigate('/framework-portal/profile')}
              className="w-full py-2 text-sm font-semibold text-white rounded-xl mt-2"
              style={{ backgroundColor: ACCENT }}
            >
              Upload Documents →
            </button>
          )}
        </div>
      )}

      {/* Quick stats */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total WOs" value={metrics.summary.total_work_orders} icon="🔧" />
          <StatCard label="Completed" value={metrics.summary.completed} icon="✅" color="text-green-600" />
          <StatCard label="Completion Rate" value={`${metrics.summary.completion_rate}%`} icon="📈" color="text-amber-600" />
          <StatCard label="On-Time Rate" value={`${metrics.summary.on_time_rate}%`} icon="⏱️" color="text-blue-600" />
        </div>
      )}

      {/* Active work orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Active Work Orders</h2>
          <button onClick={() => navigate('/framework-portal/work-orders')} className="text-xs text-amber-600 font-medium">View all</button>
        </div>
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>
        ) : active.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <div className="text-3xl mb-2">🔧</div>
            <p className="text-sm text-gray-500">No active work orders</p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(wo => (
              <button
                key={wo.id}
                onClick={() => navigate(`/framework-portal/work-orders/${wo.id}`)}
                className="w-full bg-white rounded-2xl border border-gray-100 p-4 text-left hover:border-amber-200 transition"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">{wo.work_order_number}</div>
                    <div className="text-sm font-semibold text-gray-900 leading-tight">{wo.title}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[wo.status] || 'bg-gray-100 text-gray-600'}`}>
                    {wo.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{SERVICE_LABELS[wo.service_type] || wo.service_type}</span>
                  <span>·</span>
                  <span>📅 {wo.planned_date}</span>
                  <span>·</span>
                  <span>{wo.total_assets} sites</span>
                </div>
                {wo.route_stops.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {wo.route_stops.slice(0, 3).map(s => (
                      <span key={s.sequence} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-500">
                        {s.site_code}
                      </span>
                    ))}
                    {wo.route_stops.length > 3 && (
                      <span className="text-[10px] text-gray-400">+{wo.route_stops.length - 3} more</span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sites coverage */}
      {vendor && vendor.site_codes.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3">My Sites</h2>
          <div className="flex flex-wrap gap-2">
            {vendor.site_codes.map(sc => (
              <span key={sc} className="text-xs font-medium px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {sc}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KycCheck({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${done ? 'bg-green-500 text-white' : 'bg-white border-2 border-gray-300'}`}>
        {done ? '✓' : ''}
      </div>
      <span className={`text-sm ${done ? 'text-gray-500 line-through' : 'text-gray-700'}`}>{label}</span>
    </div>
  )
}

function StatCard({ label, value, icon, color = 'text-gray-900' }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-lg mb-1">{icon}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}
