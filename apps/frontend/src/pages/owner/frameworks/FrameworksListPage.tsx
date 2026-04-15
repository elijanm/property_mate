import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listFrameworks, createFramework, extractContractPdf } from '@/api/frameworks'
import type { FrameworkContract, FrameworkCreateRequest } from '@/types/framework'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

const CONTRACT_COLORS = ['#D97706', '#0284C7', '#7C3AED', '#059669', '#DC2626', '#DB2777']

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  draft:     'bg-gray-100 text-gray-600',
  expired:   'bg-red-100 text-red-700',
  suspended: 'bg-yellow-100 text-yellow-700',
}

type Section = 'dashboard' | 'contracts' | 'route-planner' | 'calendar' | 'settings'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '📊' },
  { id: 'contracts',    label: 'Contracts',    icon: '📄' },
  { id: 'route-planner',label: 'Route Planner',icon: '🗺️' },
  { id: 'calendar',     label: 'Calendar',     icon: '📅' },
  { id: 'settings',     label: 'Settings',     icon: '⚙️' },
]

export default function FrameworksListPage() {
  const navigate = useNavigate()
  const [frameworks, setFrameworks] = useState<FrameworkContract[]>([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<Section>('dashboard')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    listFrameworks().then(setFrameworks).finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ── Sidebar ── */}
      <aside className="flex flex-col w-56 bg-white border-r border-gray-200 shrink-0">
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <button
            onClick={() => navigate('/portfolio')}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition mb-3"
          >
            ← Portfolio
          </button>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
              style={{ backgroundColor: `${ACCENT}20` }}
            >
              ⚡
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Frameworks</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Asset Management</p>
            </div>
          </div>
        </div>

        {/* Top-level nav */}
        <nav className="py-2 px-2 border-b border-gray-100">
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
                section === item.id
                  ? 'font-semibold text-white'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              style={section === item.id ? { backgroundColor: ACCENT } : {}}
            >
              <span className="text-base leading-none shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Contract quick-links */}
        {frameworks.length > 0 && (
          <div className="flex-1 overflow-y-auto py-3 px-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">
              Contracts ({frameworks.length})
            </p>
            {frameworks.map(fw => (
              <button
                key={fw.id}
                onClick={() => navigate(`/portfolio/frameworks/${fw.id}`)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition text-left group"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: fw.color ?? ACCENT }}
                />
                <span className="truncate flex-1">{fw.name}</span>
                <span className="text-gray-300 group-hover:text-gray-500 text-xs shrink-0">→</span>
              </button>
            ))}
          </div>
        )}

        {/* New contract */}
        <div className="p-3 border-t border-gray-100 mt-auto">
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white rounded-lg transition hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            + New Contract
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : section === 'dashboard' ? (
          <DashboardSection frameworks={frameworks} navigate={navigate} onNewContract={() => setShowCreate(true)} />
        ) : section === 'contracts' ? (
          <ContractsSection frameworks={frameworks} navigate={navigate} onNewContract={() => setShowCreate(true)} />
        ) : section === 'route-planner' ? (
          <RoutePlannerSection frameworks={frameworks} navigate={navigate} />
        ) : section === 'calendar' ? (
          <CalendarSection frameworks={frameworks} />
        ) : (
          <SettingsSection />
        )}
      </main>

      {showCreate && (
        <CreateFrameworkModal
          onClose={() => setShowCreate(false)}
          onCreated={(fw) => {
            setFrameworks(prev => [fw, ...prev])
            setShowCreate(false)
            navigate(`/portfolio/frameworks/${fw.id}`)
          }}
        />
      )}
    </div>
  )
}

// ── Dashboard section ─────────────────────────────────────────────────────────

function DashboardSection({
  frameworks, navigate, onNewContract,
}: {
  frameworks: FrameworkContract[]
  navigate: ReturnType<typeof useNavigate>
  onNewContract: () => void
}) {
  const totalAssets       = frameworks.reduce((s, f) => s + f.total_assets, 0)
  const totalOverdue      = frameworks.reduce((s, f) => s + f.overdue_schedules, 0)
  const totalOpenWOs      = frameworks.reduce((s, f) => s + f.active_work_orders, 0)
  const activeContracts   = frameworks.filter(f => f.status === 'active').length
  const expiringContracts = frameworks.filter(f => {
    const days = Math.ceil((new Date(f.contract_end).getTime() - Date.now()) / 86400000)
    return days > 0 && days <= 60
  })

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-1">Framework Management</p>
          <h1 className="text-2xl font-bold text-gray-900">Overview Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Critical metrics across all active framework contracts</p>
        </div>
        <button
          onClick={onNewContract}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: ACCENT }}
        >
          + New Contract
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Active Contracts', value: activeContracts, icon: '📄', color: 'text-gray-900' },
          { label: 'Total Assets', value: totalAssets, icon: '⚡', color: 'text-gray-900' },
          { label: 'Open Work Orders', value: totalOpenWOs, icon: '🔧', color: 'text-gray-900' },
          { label: 'Overdue Schedules', value: totalOverdue, icon: '⚠️', color: totalOverdue > 0 ? 'text-red-600' : 'text-gray-900' },
          { label: 'Expiring Soon', value: expiringContracts.length, icon: '⏳', color: expiringContracts.length > 0 ? 'text-orange-600' : 'text-gray-900' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xl mb-2">{stat.icon}</div>
            <div className={`text-2xl font-bold mb-0.5 ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {frameworks.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl">
          <div className="text-5xl mb-4">⚡</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No framework contracts yet</h3>
          <p className="text-sm text-gray-500 mb-6">Create your first asset maintenance contract to get started.</p>
          <button
            onClick={onNewContract}
            className="px-5 py-2 text-sm font-semibold text-white rounded-lg"
            style={{ backgroundColor: ACCENT }}
          >
            Create Contract
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contract health table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Contract Health</h2>
              <span className="text-xs text-gray-400">{frameworks.length} contracts</span>
            </div>
            <div className="divide-y divide-gray-50">
              {frameworks.map(fw => {
                const daysLeft = Math.ceil((new Date(fw.contract_end).getTime() - Date.now()) / 86400000)
                return (
                  <div
                    key={fw.id}
                    onClick={() => navigate(`/portfolio/frameworks/${fw.id}`)}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-amber-50 cursor-pointer transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fw.color ?? ACCENT }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{fw.name}</div>
                      <div className="text-xs text-gray-400">{fw.client_name} · {fw.total_assets} assets</div>
                    </div>
                    <div className="flex items-center gap-3 text-right shrink-0">
                      {fw.overdue_schedules > 0 && (
                        <span className="text-xs font-bold text-red-600">⚠️ {fw.overdue_schedules} overdue</span>
                      )}
                      {fw.active_work_orders > 0 && (
                        <span className="text-xs text-blue-600 font-semibold">{fw.active_work_orders} WOs</span>
                      )}
                      <span className={`text-xs font-medium ${daysLeft < 60 ? 'text-orange-600' : 'text-gray-400'}`}>
                        {daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Expiring contracts */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900">Expiring in 60 Days</h2>
              </div>
              {expiringContracts.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-gray-400">No contracts expiring soon ✓</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {expiringContracts.map(fw => {
                    const days = Math.ceil((new Date(fw.contract_end).getTime() - Date.now()) / 86400000)
                    return (
                      <div key={fw.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <div className="text-xs font-semibold text-gray-900 truncate max-w-[140px]">{fw.name}</div>
                          <div className="text-[10px] text-gray-400">{fw.client_name}</div>
                        </div>
                        <span className="text-xs font-bold text-orange-600 shrink-0">{days}d</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {[
                  { label: 'View Route Planner', icon: '🗺️', action: 'route-planner' as Section },
                  { label: 'Maintenance Calendar', icon: '📅', action: 'calendar' as Section },
                  { label: 'All Contracts', icon: '📄', action: 'contracts' as Section },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => {
                      const el = document.querySelector(`[data-section="${item.action}"]`) as HTMLButtonElement
                      el?.click()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-800 transition text-left"
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Contracts section ─────────────────────────────────────────────────────────

function ContractsSection({
  frameworks, navigate, onNewContract,
}: {
  frameworks: FrameworkContract[]
  navigate: ReturnType<typeof useNavigate>
  onNewContract: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = frameworks.filter(fw =>
    !search || fw.name.toLowerCase().includes(search.toLowerCase()) || fw.client_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">All Contracts</h1>
          <p className="text-sm text-gray-500 mt-0.5">{frameworks.length} framework contracts</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contracts…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-48"
          />
          <button
            onClick={onNewContract}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
            style={{ backgroundColor: ACCENT }}
          >
            + New Contract
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl">
          <div className="text-5xl mb-4">⚡</div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">{search ? 'No matches' : 'No contracts yet'}</h3>
          {!search && (
            <button onClick={onNewContract} className="mt-4 px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
              Create Contract
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {filtered.map(fw => (
            <div
              key={fw.id}
              onClick={() => navigate(`/portfolio/frameworks/${fw.id}`)}
              className="bg-white rounded-2xl border border-gray-200 hover:border-amber-300 hover:shadow-md cursor-pointer transition-all group overflow-hidden"
            >
              <div className="h-1" style={{ backgroundColor: fw.color ?? ACCENT }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: `${fw.color ?? ACCENT}15` }}>⚡</div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_COLORS[fw.status]}`}>{fw.status}</span>
                </div>
                <h2 className="text-sm font-bold text-gray-900 mb-0.5 group-hover:text-amber-700 transition-colors">{fw.name}</h2>
                <p className="text-xs text-gray-500 mb-3">{fw.client_name} · {fw.contract_number}</p>
                <div className="grid grid-cols-3 gap-2 text-center border-t border-gray-50 pt-3">
                  <div><div className="text-base font-bold text-gray-900">{fw.total_assets}</div><div className="text-[10px] text-gray-400">Assets</div></div>
                  <div><div className="text-base font-bold text-gray-900">{fw.active_work_orders}</div><div className="text-[10px] text-gray-400">Open WOs</div></div>
                  <div>
                    <div className={`text-base font-bold ${fw.overdue_schedules > 0 ? 'text-red-600' : 'text-gray-900'}`}>{fw.overdue_schedules}</div>
                    <div className="text-[10px] text-gray-400">Overdue</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-400">
                  <span>📍 {fw.region}</span>
                  <span>·</span>
                  <span>{new Date(fw.contract_end) < new Date() ? '⚠️ Expired' : `Ends ${new Date(fw.contract_end).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs font-medium text-amber-600 group-hover:text-amber-700">
                  Open workspace <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Route Planner section ─────────────────────────────────────────────────────

function RoutePlannerSection({
  frameworks, navigate,
}: {
  frameworks: FrameworkContract[]
  navigate: ReturnType<typeof useNavigate>
}) {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Route Planner</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Plan optimised service routes across all framework contracts. Open a specific contract to run the full planner.
        </p>
      </div>

      {frameworks.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="text-sm text-gray-500">Create a framework contract first to access route planning.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Tip:</strong> The full route optimizer (with GPS asset selection, distance calculation, and work order creation) is available inside each contract workspace under <em>Route Planner</em>.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {frameworks.filter(f => f.status === 'active').map(fw => (
              <div
                key={fw.id}
                onClick={() => navigate(`/portfolio/frameworks/${fw.id}/route-planner`)}
                className="bg-white rounded-xl border border-gray-200 hover:border-amber-300 hover:shadow-sm cursor-pointer transition-all p-5 group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: fw.color ?? ACCENT }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">{fw.name}</div>
                    <div className="text-xs text-gray-400">{fw.region} · {fw.total_assets} assets</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-600 group-hover:text-amber-700 font-medium">
                  Open route planner <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Calendar section ──────────────────────────────────────────────────────────

function CalendarSection({ frameworks }: { frameworks: FrameworkContract[] }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const monthDate = new Date(`${month}-01`)
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
  const firstDayOfWeek = new Date(`${month}-01`).getDay()

  // Placeholder events — in production these come from listSchedules across all frameworks
  const events: { day: number; label: string; color: string }[] = frameworks.flatMap((fw, i) => {
    // Generate some placeholder event days based on framework index for demo
    const days = [5 + i * 7, 12 + i * 3, 20 + i * 2].filter(d => d <= daysInMonth)
    return days.map(day => ({ day, label: fw.name, color: fw.color ?? ACCENT }))
  })

  const eventsByDay = events.reduce<Record<number, typeof events>>((acc, ev) => {
    acc[ev.day] = acc[ev.day] ?? []
    acc[ev.day].push(ev)
    return acc
  }, {})

  const weeks: (number | null)[][] = []
  let week: (number | null)[] = Array(firstDayOfWeek).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) { weeks.push([...week, ...Array(7 - week.length).fill(null)]) }

  const today = new Date()

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Maintenance Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Scheduled maintenance across all framework contracts</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      {/* Contract legend */}
      {frameworks.length > 0 && (
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          {frameworks.map(fw => (
            <div key={fw.id} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: fw.color ?? ACCENT }} />
              {fw.name}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-semibold text-gray-400">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
            {week.map((day, di) => {
              const isToday = day !== null &&
                today.getDate() === day &&
                today.getMonth() === monthDate.getMonth() &&
                today.getFullYear() === monthDate.getFullYear()
              const dayEvents = day ? eventsByDay[day] ?? [] : []

              return (
                <div
                  key={di}
                  className={`min-h-[80px] p-1.5 border-r border-gray-50 last:border-0 ${day ? 'bg-white' : 'bg-gray-50'}`}
                >
                  {day && (
                    <>
                      <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium mb-1 ${
                        isToday ? 'text-white font-bold' : 'text-gray-700'
                      }`} style={isToday ? { backgroundColor: ACCENT } : {}}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev, i) => (
                          <div
                            key={i}
                            className="text-[9px] font-semibold px-1 py-0.5 rounded truncate text-white"
                            style={{ backgroundColor: ev.color }}
                          >
                            {ev.label}
                          </div>
                        ))}
                        {dayEvents.length > 2 && (
                          <div className="text-[9px] text-gray-400">+{dayEvents.length - 2} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {frameworks.length === 0 && (
        <div className="mt-6 text-center py-8 text-sm text-gray-400">
          Create framework contracts to see scheduled maintenance on this calendar.
        </div>
      )}
    </div>
  )
}

// ── Settings section ──────────────────────────────────────────────────────────

function SettingsSection() {
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState({
    default_currency: 'KES',
    default_region: '',
    alert_overdue_days: 3,
    alert_expiry_days: 60,
    sla_penalty_threshold: 5,
    enable_route_optimization: true,
    require_gps_for_assets: false,
    auto_create_work_orders: false,
  })

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Global Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Default configuration applied across all framework contracts</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {/* Currency */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Default Currency</p>
            <p className="text-xs text-gray-500">Used for cost estimates and invoicing</p>
          </div>
          <select
            value={settings.default_currency}
            onChange={e => setSettings(p => ({ ...p, default_currency: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="KES">KES — Kenyan Shilling</option>
            <option value="USD">USD — US Dollar</option>
            <option value="UGX">UGX — Ugandan Shilling</option>
            <option value="TZS">TZS — Tanzanian Shilling</option>
          </select>
        </div>

        {/* Alert thresholds */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm font-semibold text-gray-900">Alert Thresholds</p>
          {[
            { label: 'Flag overdue schedules after (days)', key: 'alert_overdue_days' as const },
            { label: 'Warn on contract expiry within (days)', key: 'alert_expiry_days' as const },
            { label: 'SLA penalty alert threshold (%)', key: 'sla_penalty_threshold' as const },
          ].map(field => (
            <div key={field.key} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{field.label}</span>
              <input
                type="number"
                value={settings[field.key]}
                onChange={e => setSettings(p => ({ ...p, [field.key]: Number(e.target.value) }))}
                className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none"
              />
            </div>
          ))}
        </div>

        {/* Feature toggles */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">Features</p>
          {[
            { label: 'Enable route optimisation', key: 'enable_route_optimization' as const },
            { label: 'Require GPS for all assets', key: 'require_gps_for_assets' as const },
            { label: 'Auto-create work orders from schedules', key: 'auto_create_work_orders' as const },
          ].map(toggle => (
            <div key={toggle.key} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{toggle.label}</span>
              <button
                onClick={() => setSettings(p => ({ ...p, [toggle.key]: !p[toggle.key] }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${settings[toggle.key] ? 'bg-amber-500' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings[toggle.key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end mt-5">
        <button
          onClick={handleSave}
          className="px-5 py-2 text-sm font-semibold text-white rounded-lg transition"
          style={{ backgroundColor: ACCENT }}
        >
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

const EMPTY_FORM: FrameworkCreateRequest = {
  name: '', client_name: '', contract_number: '', contract_start: '',
  contract_end: '', region: '', description: '', color: CONTRACT_COLORS[0],
}

type ModalStep = 'upload' | 'review' | 'form'

function CreateFrameworkModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (fw: FrameworkContract) => void
}) {
  const [step, setStep] = useState<ModalStep>('upload')
  const [form, setForm] = useState<FrameworkCreateRequest>(EMPTY_FORM)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setExtractError('Only PDF files are supported.')
      return
    }
    setExtracting(true)
    setExtractError('')
    try {
      const data = await extractContractPdf(file)
      setForm({
        name: data.name || '',
        client_name: data.client_name || '',
        contract_number: data.contract_number || '',
        contract_start: data.contract_start || '',
        contract_end: data.contract_end || '',
        region: data.region || '',
        description: data.description || '',
        color: CONTRACT_COLORS[0],
      })
      setConfidence(data.confidence)
      setStep('review')
    } catch (err) {
      setExtractError(extractApiError(err).message || 'Failed to extract contract details.')
    } finally {
      setExtracting(false)
    }
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const fw = await createFramework(form)
      onCreated(fw)
    } catch (err) {
      setSaveError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const CONFIDENCE_STYLE = {
    high:   'bg-green-50 text-green-700 border-green-200',
    medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    low:    'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-gray-900">New Framework Contract</h2>
            {step !== 'upload' && (
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${step === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  1 Extract
                </span>
                <span className="text-gray-300 text-xs">›</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${step === 'form' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  2 Review & Save
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* ── Step 1: Upload PDF ── */}
          {step === 'upload' && (
            <div className="p-6">
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
                  dragging ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                }`}
              >
                {extracting ? (
                  <>
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium text-gray-600">Extracting contract details…</p>
                    <p className="text-xs text-gray-400">This may take a few seconds</p>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center text-2xl">📄</div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-gray-900">Drop your PDF contract here</p>
                      <p className="text-xs text-gray-400 mt-1">or click to browse — we'll extract the details automatically</p>
                    </div>
                    <span className="text-xs px-3 py-1 bg-gray-100 text-gray-500 rounded-full">PDF up to 20 MB</span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {extractError && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{extractError}</p>
              )}

              <div className="flex items-center gap-3 mt-5">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400 shrink-0">or skip and fill manually</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              <button
                onClick={() => setStep('form')}
                className="mt-4 w-full px-4 py-2.5 text-sm font-semibold text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
              >
                Fill in manually →
              </button>
            </div>
          )}

          {/* ── Step 2: Review extracted data ── */}
          {step === 'review' && (
            <div className="p-6">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium mb-5 ${confidence ? CONFIDENCE_STYLE[confidence] : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                <span>{confidence === 'high' ? '✓' : confidence === 'medium' ? '⚠' : '⚠'}</span>
                <span>
                  AI extraction confidence: <strong className="capitalize">{confidence}</strong>
                  {confidence !== 'high' && ' — please review all fields carefully before saving.'}
                </span>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Review the extracted details below. Edit any field that needs correction, then save to create the contract.
              </p>

              <ContractFormFields form={form} setForm={setForm} />

              <div className="flex justify-between gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setStep('upload'); setConfidence(null) }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                >
                  ← Re-upload
                </button>
                <button
                  onClick={() => setStep('form')}
                  className="px-5 py-2 text-sm font-semibold text-white rounded-lg"
                  style={{ backgroundColor: ACCENT }}
                >
                  Looks good — Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Final form + save ── */}
          {step === 'form' && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {saveError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}

              <ContractFormFields form={form} setForm={setForm} />

              <div className="col-span-2 pt-1">
                <label className="block text-xs font-semibold text-gray-700 mb-2">Contract Color</label>
                <div className="flex items-center gap-2">
                  {CONTRACT_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(p => ({ ...p, color: c }))}
                      className={`w-7 h-7 rounded-full transition ring-offset-2 ${form.color === c ? 'ring-2 ring-gray-400' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              <div className="flex justify-between gap-3 pt-2">
                {step === 'form' && confidence !== null && (
                  <button type="button" onClick={() => setStep('review')} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
                    ← Back
                  </button>
                )}
                {confidence === null && (
                  <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                )}
                <button type="submit" disabled={saving}
                  className="ml-auto px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}>
                  {saving ? 'Creating…' : 'Create Contract'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared contract form fields component ─────────────────────────────────────

function ContractFormFields({
  form,
  setForm,
}: {
  form: FrameworkCreateRequest
  setForm: React.Dispatch<React.SetStateAction<FrameworkCreateRequest>>
}) {
  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-700 mb-1">Contract Name *</label>
        <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          placeholder="KCB Bank Generator Maintenance"
          className={field} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Client Name *</label>
        <input required value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
          placeholder="KCB Bank Group"
          className={field} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Contract Number *</label>
        <input required value={form.contract_number} onChange={e => setForm(p => ({ ...p, contract_number: e.target.value }))}
          placeholder="KCB/GEN/2025/001"
          className={field} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Contract Start *</label>
        <input
          required
          type="date"
          value={form.contract_start}
          onChange={e => {
            const start = e.target.value
            let end = form.contract_end
            if (start) {
              const d = new Date(start)
              d.setFullYear(d.getFullYear() + 1)
              end = d.toISOString().slice(0, 10)
            }
            setForm(p => ({ ...p, contract_start: start, contract_end: end }))
          }}
          className={field}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Contract End *</label>
        <input required type="date" value={form.contract_end} onChange={e => setForm(p => ({ ...p, contract_end: e.target.value }))}
          className={field} />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-700 mb-1">Region / Coverage Area *</label>
        <input required value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))}
          placeholder="Central Region, Nairobi, Kenya"
          className={field} />
      </div>
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-700 mb-1">Description</label>
        <textarea rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="Brief description of the contract scope..."
          className={`${field} resize-none`} />
      </div>
    </div>
  )
}
