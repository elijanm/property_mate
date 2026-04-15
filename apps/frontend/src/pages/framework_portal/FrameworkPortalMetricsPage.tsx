import { useEffect, useState } from 'react'
import { getMyMetrics } from '@/api/frameworkPortal'
import type { PortalMetrics } from '@/api/frameworkPortal'

export default function FrameworkPortalMetricsPage() {
  const [metrics, setMetrics] = useState<PortalMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMyMetrics().then(setMetrics).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!metrics) return (
    <div className="text-center py-20 text-sm text-gray-400">No metrics available</div>
  )

  const { summary, sites } = metrics

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Performance Metrics</h1>
        <p className="text-xs text-gray-500 mt-0.5">Your service delivery performance overview</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <BigStat label="Total WOs" value={summary.total_work_orders} icon="🔧" />
        <BigStat label="Completed" value={summary.completed} icon="✅" color="text-green-600" />
        <BigStat label="In Progress" value={summary.in_progress} icon="⚙️" color="text-amber-600" />
        <BigStat label="Pending" value={summary.pending} icon="⏳" color="text-blue-600" />
      </div>

      {/* Rate gauges */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">Performance Rates</h2>
        <RateBar label="Completion Rate" value={summary.completion_rate} color="#10B981" />
        <RateBar label="On-Time Rate" value={summary.on_time_rate} color="#3B82F6" />
        <RateBar label="Pre-Inspection Rate" value={summary.pre_inspection_rate} color="#8B5CF6" />
      </div>

      {/* Work order breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Status Breakdown</h2>
        <div className="space-y-2">
          {[
            { label: 'Completed', count: summary.completed, color: '#10B981' },
            { label: 'In Progress', count: summary.in_progress, color: '#F59E0B' },
            { label: 'Pending', count: summary.pending, color: '#3B82F6' },
            { label: 'Cancelled', count: summary.cancelled, color: '#EF4444' },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-3">
              <div className="w-24 text-xs text-gray-500">{row.label}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: summary.total_work_orders > 0
                      ? `${(row.count / summary.total_work_orders) * 100}%`
                      : '0%',
                    backgroundColor: row.color,
                  }}
                />
              </div>
              <div className="text-xs font-bold text-gray-700 w-6 text-right">{row.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Site performance */}
      {sites.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Performance by Site</h2>
          <div className="space-y-3">
            {sites.map(site => {
              const rate = site.total_work_orders > 0
                ? Math.round((site.completed / site.total_work_orders) * 100)
                : 0
              return (
                <div key={site.site_code}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-700">{site.site_code}</span>
                    <span className="text-xs text-gray-400">{site.completed}/{site.total_work_orders} WOs</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${rate}%`, backgroundColor: '#D97706' }}
                    />
                  </div>
                  <div className="text-[10px] text-right text-gray-400 mt-0.5">{rate}%</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function BigStat({ label, value, icon, color = 'text-gray-900' }: {
  label: string; value: number; icon: string; color?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

function RateBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-bold text-gray-800">{value}%</span>
      </div>
      <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
