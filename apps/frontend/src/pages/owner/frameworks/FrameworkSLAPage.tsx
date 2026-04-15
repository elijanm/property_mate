import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listSlaRecords } from '@/api/frameworks'
import type { SlaRecord } from '@/types/framework'
import { SLA_LEVEL_LABELS, SLA_LEVEL_COLORS } from '@/types/framework'

const PENALTY_EVENTS = [
  { key: 'delayed_response', label: 'Delayed Emergency Response (>4 hrs)', pct: 5 },
  { key: 'missed_ppm', label: 'Missed Scheduled PPM Visit', pct: 5 },
  { key: 'incomplete_report', label: 'Incomplete Service Report', pct: 5 },
  { key: 'unresolved_fault', label: 'Unresolved Fault >48 hrs', pct: 5 },
  { key: 'parts_unavailable', label: 'Parts Not Available (Major Repair Delay)', pct: 10 },
  { key: 'no_standby', label: 'No Standby Generator Provided', pct: 5 },
  { key: 'data_not_submitted', label: 'Monthly Activity Report Not Submitted', pct: 5 },
]

const QUARTER_OPTIONS = () => {
  const quarters = []
  const now = new Date()
  for (let i = 0; i < 4; i++) {
    const d = new Date(now)
    d.setMonth(now.getMonth() - i * 3)
    const q = Math.ceil((d.getMonth() + 1) / 3)
    quarters.push(`${d.getFullYear()}-Q${q}`)
  }
  return [...new Set(quarters)]
}

export default function FrameworkSLAPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [records, setRecords] = useState<SlaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`
  })

  useEffect(() => {
    if (!frameworkId) return
    setLoading(true)
    listSlaRecords(frameworkId, { period }).then(setRecords).finally(() => setLoading(false))
  }, [frameworkId, period])

  const totalPenalties = records.reduce((s, r) => s + (r.penalty_amount ?? 0), 0)
  const avgResponseTime = records.length
    ? records.reduce((s, r) => s + (r.response_time_hours ?? 0), 0) / records.filter(r => r.response_time_hours).length
    : 0
  const levelCounts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.sla_level] = (acc[r.sla_level] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">SLA & Compliance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Service level tracking, penalties, and compliance reporting</p>
        </div>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          {QUARTER_OPTIONS().map(q => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-red-600">KES {totalPenalties.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Penalties ({period})</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{records.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Asset SLA Records</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">
            {isNaN(avgResponseTime) ? '—' : `${avgResponseTime.toFixed(1)}h`}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Avg Response Time</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{levelCounts['exceptional'] ?? 0}</div>
          <div className="text-xs text-gray-500 mt-0.5">Exceptional SLA Assets</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SLA Records table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Asset SLA Records — {period}</h2>
          </div>
          {loading ? (
            <div className="py-12 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm text-gray-500">No SLA records for {period}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Site</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Response</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Resolution</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">SLA Level</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Penalty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {records.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{r.site_name}</div>
                        <div className="text-xs text-gray-400">{r.events.length} event{r.events.length !== 1 ? 's' : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        {r.response_time_hours != null ? `${r.response_time_hours}h` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        {r.resolution_time_hours != null ? `${r.resolution_time_hours}h` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SLA_LEVEL_COLORS[r.sla_level]}`}>
                          {SLA_LEVEL_LABELS[r.sla_level]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.penalty_amount ? (
                          <span className="text-xs font-semibold text-red-600">KES {r.penalty_amount.toLocaleString()}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Penalty reference */}
        <div className="space-y-4">
          {/* SLA Level distribution */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">SLA Distribution</h3>
            <div className="space-y-2">
              {(['exceptional', 'very_good', 'marginal', 'unsatisfactory', 'defective'] as const).map(level => {
                const count = levelCounts[level] ?? 0
                const pct = records.length ? (count / records.length) * 100 : 0
                return (
                  <div key={level}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">{SLA_LEVEL_LABELS[level]}</span>
                      <span className="font-semibold text-gray-900">{count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: level === 'exceptional' || level === 'very_good' ? '#10B981' :
                            level === 'marginal' ? '#F59E0B' :
                            level === 'unsatisfactory' ? '#F97316' : '#EF4444',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Penalty reference table */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Penalty Reference</h3>
            <div className="space-y-2">
              {PENALTY_EVENTS.map(ev => (
                <div key={ev.key} className="flex items-start justify-between gap-2">
                  <span className="text-[11px] text-gray-600 leading-tight">{ev.label}</span>
                  <span className={`shrink-0 text-xs font-bold ${ev.pct >= 10 ? 'text-red-600' : 'text-orange-600'}`}>
                    {ev.pct}%
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              Penalties deducted from quarterly invoice. SLA assessment period: per quarter.
            </p>
          </div>

          {/* SLA threshold guide */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h3 className="text-xs font-bold text-amber-900 mb-2">SLA Response Standards</h3>
            <div className="space-y-1.5 text-[11px] text-amber-800">
              <div>🚨 Emergency: Response &lt; 4 hours</div>
              <div>⚡ Critical: Resolution &lt; 24 hours</div>
              <div>🔧 Routine PPM: As per schedule</div>
              <div>📊 Monthly Report: 5th of following month</div>
              <div>📄 Biannual Report: 30 days post-PPM</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
