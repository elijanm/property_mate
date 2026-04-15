import { useEffect, useState, useContext } from 'react'
import { useParams } from 'react-router-dom'
import { getFrameworkStats, listSchedules, listWorkOrders } from '@/api/frameworks'
import type { FrameworkStats, MaintenanceSchedule, WorkOrder } from '@/types/framework'
import { SERVICE_TYPE_LABELS } from '@/types/framework'
import { FrameworkContext } from './FrameworkWorkspacePage'

function StatCard({ label, value, icon, sub, warn }: {
  label: string; value: string | number; icon: string; sub?: string; warn?: boolean
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${warn ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xl">{icon}</span>
        {warn && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Action needed</span>}
      </div>
      <div className={`text-3xl font-bold mb-0.5 ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function FrameworkDashboardPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const { framework } = useContext(FrameworkContext)
  const [stats, setStats] = useState<FrameworkStats | null>(null)
  const [upcomingSchedules, setUpcomingSchedules] = useState<MaintenanceSchedule[]>([])
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!frameworkId) return
    Promise.all([
      getFrameworkStats(frameworkId),
      listSchedules(frameworkId, { status: 'pending' }),
      listWorkOrders(frameworkId, { page: 1 }),
    ]).then(([s, schedules, wos]) => {
      setStats(s)
      setUpcomingSchedules(schedules.slice(0, 5))
      setRecentWorkOrders((wos.items ?? wos as unknown as WorkOrder[]).slice(0, 5))
    }).finally(() => setLoading(false))
  }, [frameworkId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const contractEnd = framework?.contract_end ? new Date(framework.contract_end) : null
  const daysToExpiry = contractEnd
    ? Math.ceil((contractEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-xl font-bold text-gray-900">{framework?.name ?? 'Dashboard'}</h1>
        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
          <span>📄 {framework?.contract_number}</span>
          <span>·</span>
          <span>👤 {framework?.client_name}</span>
          <span>·</span>
          <span>📍 {framework?.region}</span>
          {daysToExpiry !== null && (
            <>
              <span>·</span>
              <span className={daysToExpiry < 60 ? 'text-red-600 font-semibold' : ''}>
                {daysToExpiry > 0 ? `⏳ ${daysToExpiry}d to expiry` : '⚠️ Contract expired'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Assets" value={stats?.total_assets ?? 0} icon="⚡" />
        <StatCard label="Operational" value={stats?.operational ?? 0} icon="✅" sub="Running normally" />
        <StatCard label="Under Maintenance" value={stats?.under_maintenance ?? 0} icon="🔧" />
        <StatCard
          label="Overdue Schedules"
          value={stats?.overdue_schedules ?? 0}
          icon="⚠️"
          warn={(stats?.overdue_schedules ?? 0) > 0}
        />
        <StatCard label="Open Work Orders" value={stats?.open_work_orders ?? 0} icon="📋" />
        <StatCard label="Completed This Month" value={stats?.completed_this_month ?? 0} icon="🏁" />
        <StatCard label="Fault / Offline" value={stats?.fault ?? 0} icon="🔴" warn={(stats?.fault ?? 0) > 0} />
        <StatCard
          label="SLA Score"
          value={stats?.avg_sla_score != null ? `${stats.avg_sla_score.toFixed(0)}%` : '—'}
          icon="📊"
          sub="Current quarter"
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming scheduled maintenance */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Upcoming Maintenance</h2>
            <a href="schedule" className="text-xs text-amber-600 hover:text-amber-700 font-medium">View all →</a>
          </div>
          {upcomingSchedules.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No upcoming schedules</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {upcomingSchedules.map(s => (
                <li key={s.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.asset_site_name}</p>
                    <p className="text-xs text-gray-400">{SERVICE_TYPE_LABELS[s.service_type]} · {s.asset_region}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-700">
                      {new Date(s.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                    <ScheduleStatusBadge status={s.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent work orders */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Recent Work Orders</h2>
            <a href="work-orders" className="text-xs text-amber-600 hover:text-amber-700 font-medium">View all →</a>
          </div>
          {recentWorkOrders.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No work orders yet</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentWorkOrders.map(wo => (
                <li key={wo.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{wo.work_order_number}</p>
                    <p className="text-xs text-gray-400">
                      {wo.total_assets} asset{wo.total_assets !== 1 ? 's' : ''} · {wo.assigned_vendor_name ?? 'Unassigned'}
                    </p>
                  </div>
                  <WoStatusBadge status={wo.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* SLA Summary */}
      {stats && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">SLA & Penalty Exposure</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {stats.avg_sla_score != null ? `${stats.avg_sla_score.toFixed(0)}%` : '—'}
              </div>
              <div className="text-xs text-gray-500">Avg SLA Score (QTD)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                KES {(stats.total_penalties_qtd ?? 0).toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">Penalties QTD</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{stats.decommissioned ?? 0}</div>
              <div className="text-xs text-gray-500">Decommissioned Assets</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScheduleStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function WoStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    assigned: 'bg-blue-100 text-blue-700',
    en_route: 'bg-indigo-100 text-indigo-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    signed_off: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
