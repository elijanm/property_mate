import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import TopBar from '@/components/TopBar'
import { SIDEBAR_BACK_LINK_POSITION } from '@/constants/layout'

interface BackLink {
  label: string
  to: string
}

interface NavItem {
  label: string
  path: string
  icon: string
  exact?: boolean
}

const ROLE_NAV: Record<string, NavItem[]> = {
  owner: [
    { label: 'Dashboard',    path: '/owner',               icon: '◫', exact: true },
    { label: 'Portfolio',    path: '/portfolio',           icon: '🗂' },
    { label: 'Tickets',      path: '/owner/tickets',       icon: '🎫' },
    { label: 'Settings',     path: '/owner/settings',      icon: '⚙' },
  ],
  agent: [
    { label: 'Dashboard',  path: '/agent',         icon: '◫', exact: true },
    { label: 'Portfolio',  path: '/portfolio',     icon: '🗂' },
    { label: 'Tickets',    path: '/owner/tickets', icon: '🎫' },
  ],
  tenant: [
    { label: 'Dashboard', path: '/tenant',          icon: '◫', exact: true },
    { label: 'Invoices',  path: '/tenant/invoices', icon: '🧾' },
    { label: 'Tickets',   path: '/tenant/tickets',  icon: '🎫' },
  ],
  service_provider: [
    { label: 'Vendor Portal', path: '/service-provider', icon: '🔧', exact: true },
  ],
  superadmin: [
    { label: 'Platform Overview', path: '/superadmin',       icon: '◫', exact: true },
    { label: 'Users',             path: '/superadmin/users', icon: '👤' },
    { label: 'Portfolio',         path: '/portfolio',        icon: '🗂' },
    { label: 'New Property',      path: '/portfolio/properties/new', icon: '+', exact: true },
    { label: 'Tenants',           path: '/tenants',          icon: '👥' },
  ],
}

function SidebarLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path)

  return (
    <Link
      to={item.path}
      className={[
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
      ].join(' ')}
    >
      <span className="w-4 text-center text-sm">{item.icon}</span>
      {item.label}
    </Link>
  )
}

export default function DashboardLayout({ children, backLink }: { children: React.ReactNode; backLink?: BackLink }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const navItems = ROLE_NAV[user?.role ?? ''] ?? []

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-100">
          {backLink && SIDEBAR_BACK_LINK_POSITION === 'above-logo' && (
            <button
              onClick={() => navigate(backLink.to)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3"
            >
              ← {backLink.label}
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="text-lg font-bold text-gray-900">PMS</span>
          </div>
          <p className="text-xs text-gray-400 mt-2 capitalize font-medium tracking-wide">
            {user?.role?.replace('_', ' ')}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {backLink && SIDEBAR_BACK_LINK_POSITION === 'below-logo' && (
            <>
              <button
                onClick={() => navigate(backLink.to)}
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <span className="w-4 text-center text-sm">←</span>
                {backLink.label}
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          {navItems.map((item) => (
            <SidebarLink key={item.path + item.label} item={item} />
          ))}
        </nav>

        {/* Sidebar bottom — sign out */}
        <div className="px-3 py-3 border-t border-gray-100 shrink-0">
          <button
            onClick={logout}
            className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <span className="w-4 text-center text-sm">→</span>
            Sign out
          </button>
        </div>

      </aside>

      {/* Main column: top bar + page content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
