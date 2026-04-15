import { createContext, useEffect, useState } from 'react'
import { useParams, Outlet, NavLink, useNavigate } from 'react-router-dom'
import { getFramework } from '@/api/frameworks'
import type { FrameworkContract } from '@/types/framework'
import { useAuth } from '@/hooks/useAuth'

export const FrameworkContext = createContext<{
  framework: FrameworkContract | null
  refresh: () => void
}>({ framework: null, refresh: () => {} })

const ACCENT = '#D97706'

const NAV_ITEMS = [
  { label: 'Dashboard',         icon: '📊', path: '' },
  { label: 'Assets',            icon: '⚡', path: 'assets' },
  { label: 'Schedule',          icon: '📅', path: 'schedule' },
  { label: 'Work Orders',       icon: '🔧', path: 'work-orders' },
  { label: 'Route Planner',     icon: '🗺️', path: 'route-planner' },
  { label: 'Spare Parts',       icon: '📦', path: 'inventory' },
  { label: 'Service Providers', icon: '👷', path: 'vendors' },
  { label: 'SLA & Compliance',  icon: '📋', path: 'sla' },
  { label: 'Reports',           icon: '📈', path: 'reports' },
  { label: 'Settings',          icon: '⚙️', path: 'settings' },
]

export default function FrameworkWorkspacePage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [framework, setFramework] = useState<FrameworkContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  async function load() {
    if (!frameworkId) return
    try {
      const data = await getFramework(frameworkId)
      if (data) setFramework(data)
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [frameworkId])

  const base = `/portfolio/frameworks/${frameworkId}`
  const accent = framework?.color ?? ACCENT

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <FrameworkContext.Provider value={{ framework, refresh: load }}>
      <div className="flex h-screen bg-gray-50">
        {/* Sidebar */}
        <aside
          className="flex flex-col bg-white border-r border-gray-200 shrink-0 transition-all duration-200"
          style={{ width: collapsed ? 56 : 220 }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100">
            <button
              onClick={() => navigate('/portfolio')}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition shrink-0"
              title="Back to Portfolio"
            >
              ←
            </button>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-gray-900 truncate">{framework?.name ?? 'Framework'}</span>
                  {framework?.status === 'active' && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" />
                  )}
                </div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Asset Framework</p>
              </div>
            )}
            <button
              onClick={() => setCollapsed(v => !v)}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-600 transition text-xs"
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-2 overflow-y-auto">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.path}
                to={item.path === '' ? base : `${base}/${item.path}`}
                end={item.path === ''}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 mx-1.5 my-0.5 px-2 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'font-semibold text-white'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
                style={({ isActive }) => isActive ? { backgroundColor: accent } : {}}
              >
                <span className="text-base leading-none shrink-0">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-100 p-2">
            <button
              onClick={logout}
              className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition"
            >
              <span className="text-base shrink-0">🚪</span>
              {!collapsed && <span>Sign out</span>}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </FrameworkContext.Provider>
  )
}
