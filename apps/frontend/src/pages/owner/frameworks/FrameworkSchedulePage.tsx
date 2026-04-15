import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listSchedules, listFrameworkAssets, createSchedule } from '@/api/frameworks'
import type { MaintenanceSchedule, FrameworkAsset } from '@/types/framework'
import { SERVICE_TYPE_LABELS } from '@/types/framework'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  scheduled:   'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed:   'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  cancelled:   'bg-gray-50 text-gray-400',
}

const SERVICE_COLORS: Record<string, string> = {
  biannual_a: 'border-l-amber-500',
  biannual_b: 'border-l-orange-400',
  quarterly:  'border-l-blue-500',
  corrective: 'border-l-red-400',
  emergency:  'border-l-red-600',
}

export default function FrameworkSchedulePage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([])
  const [assets, setAssets] = useState<FrameworkAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [showCreate, setShowCreate] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')

  async function load() {
    if (!frameworkId) return
    setLoading(true)
    try {
      const [schedRes, assetRes] = await Promise.all([
        listSchedules(frameworkId, { status: filterStatus, month: filterMonth }),
        listFrameworkAssets(frameworkId, { page: 1 }),
      ])
      setSchedules(schedRes)
      setAssets(assetRes.items ?? (assetRes as unknown as FrameworkAsset[]))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [frameworkId, filterStatus, filterMonth])

  const grouped = schedules.reduce<Record<string, MaintenanceSchedule[]>>((acc, s) => {
    const week = getWeekLabel(s.scheduled_date)
    acc[week] = acc[week] ?? []
    acc[week].push(s)
    return acc
  }, {})

  const overdueCount = schedules.filter(s => s.status === 'overdue').length
  const completedCount = schedules.filter(s => s.status === 'completed').length

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Maintenance Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {schedules.length} schedules · {overdueCount} overdue · {completedCount} completed
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['list', 'timeline'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 font-medium capitalize transition ${view === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
            style={{ backgroundColor: ACCENT }}
          >
            + Schedule
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="month"
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-4 text-xs">
          {Object.entries(SERVICE_TYPE_LABELS).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1 text-gray-500">
              <span className={`w-3 h-3 rounded-sm border-l-4 ${SERVICE_COLORS[k] ?? 'border-l-gray-400'} bg-gray-50`} />
              {label.split(' ')[0]}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-sm font-semibold text-gray-700">No schedules for this period</p>
          <p className="text-xs text-gray-400 mt-1">Create a maintenance schedule to track upcoming service visits.</p>
        </div>
      ) : view === 'list' ? (
        <div className="space-y-6">
          {Object.entries(grouped).map(([week, items]) => (
            <div key={week}>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{week}</h3>
              <div className="space-y-2">
                {items.map(s => (
                  <div
                    key={s.id}
                    className={`bg-white border border-gray-200 rounded-xl p-4 border-l-4 ${SERVICE_COLORS[s.service_type] ?? 'border-l-gray-300'} hover:shadow-sm transition`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{s.asset_site_name}</div>
                          <div className="text-xs text-gray-400">
                            {SERVICE_TYPE_LABELS[s.service_type]} · {s.asset_region}
                            {s.assigned_vendor_name && ` · ${s.assigned_vendor_name}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-gray-600">
                          {new Date(s.scheduled_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[s.status]}`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Timeline view */
        <TimelineView schedules={schedules} />
      )}

      {showCreate && assets.length > 0 && (
        <CreateScheduleModal
          frameworkId={frameworkId!}
          assets={assets}
          onClose={() => setShowCreate(false)}
          onCreated={(s) => { setSchedules(p => [s, ...p]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function TimelineView({ schedules }: { schedules: MaintenanceSchedule[] }) {
  // Group by region
  const regions = [...new Set(schedules.map(s => s.asset_region))]

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        {regions.map(region => {
          const items = schedules.filter(s => s.asset_region === region)
          return (
            <div key={region} className="mb-6">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>📍</span> {region}
              </h3>
              <div className="space-y-2">
                {items.map(s => {
                  const pct = getMonthProgress(s.scheduled_date)
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <div className="w-36 text-xs text-gray-600 truncate shrink-0">{s.asset_site_name}</div>
                      <div className="flex-1 relative h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="absolute top-0 h-full rounded-full flex items-center px-2"
                          style={{
                            left: `${Math.max(0, pct - 4)}%`,
                            width: '8%',
                            backgroundColor: getServiceColor(s.service_type),
                          }}
                        />
                      </div>
                      <span className={`w-20 text-[10px] font-semibold text-right ${
                        s.status === 'overdue' ? 'text-red-600' : 'text-gray-500'
                      }`}>
                        {new Date(s.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1)
  const weekNum = Math.ceil((d.getDate() + startOfMonth.getDay()) / 7)
  return `Week ${weekNum} — ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
}

function getMonthProgress(dateStr: string): number {
  const d = new Date(dateStr)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return (d.getDate() / daysInMonth) * 100
}

function getServiceColor(type: string): string {
  const map: Record<string, string> = {
    biannual_a: '#D97706',
    biannual_b: '#FB923C',
    quarterly: '#3B82F6',
    corrective: '#EF4444',
    emergency: '#DC2626',
  }
  return map[type] ?? '#9CA3AF'
}

function CreateScheduleModal({ frameworkId, assets, onClose, onCreated }: {
  frameworkId: string
  assets: FrameworkAsset[]
  onClose: () => void
  onCreated: (s: MaintenanceSchedule) => void
}) {
  const [form, setForm] = useState({
    asset_id: assets[0]?.id ?? '',
    service_type: 'biannual_a' as MaintenanceSchedule['service_type'],
    scheduled_date: '',
    assigned_vendor_id: '',
    assigned_vendor_name: '',
    estimated_duration_hours: 4,
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const asset = assets.find(a => a.id === form.asset_id)
      const s = await createSchedule(frameworkId, {
        asset_id: form.asset_id,
        asset_site_name: asset?.site_name ?? '',
        asset_region: asset?.region ?? '',
        service_type: form.service_type,
        scheduled_date: form.scheduled_date,
        status: 'pending',
        assigned_vendor_id: form.assigned_vendor_id || undefined,
        assigned_vendor_name: form.assigned_vendor_name || undefined,
        estimated_duration_hours: form.estimated_duration_hours,
        notes: form.notes || undefined,
      })
      onCreated(s)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Schedule Maintenance</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Asset *</label>
            <select
              required
              value={form.asset_id}
              onChange={e => setForm(p => ({ ...p, asset_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
            >
              {assets.map(a => <option key={a.id} value={a.id}>{a.site_name} ({a.kva_rating} KVA)</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Service Type *</label>
            <select
              required
              value={form.service_type}
              onChange={e => setForm(p => ({ ...p, service_type: e.target.value as typeof form.service_type }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
            >
              {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Scheduled Date *</label>
            <input
              required
              type="date"
              value={form.scheduled_date}
              onChange={e => setForm(p => ({ ...p, scheduled_date: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Estimated Duration (hours)</label>
            <input
              type="number"
              min={1}
              max={72}
              value={form.estimated_duration_hours}
              onChange={e => setForm(p => ({ ...p, estimated_duration_hours: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              placeholder="Any specific instructions…"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? 'Saving…' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
