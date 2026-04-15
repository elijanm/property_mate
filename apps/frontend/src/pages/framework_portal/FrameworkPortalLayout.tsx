import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getMyProfile } from '@/api/frameworkPortal'
import type { VendorProfile } from '@/api/frameworkPortal'
import { TOKEN_KEY } from '@/constants/storage'

const ACCENT = '#D97706'

const NAV = [
  { to: '/framework-portal', label: 'Home', icon: '🏠', end: true },
  { to: '/framework-portal/work-orders', label: 'Work Orders', icon: '🔧' },
  { to: '/framework-portal/tickets', label: 'Tickets', icon: '🎫' },
  { to: '/framework-portal/metrics', label: 'Metrics', icon: '📊' },
  { to: '/framework-portal/profile', label: 'Profile', icon: '👤' },
]

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  pending_review: 'bg-yellow-400',
  invited: 'bg-gray-400',
  suspended: 'bg-red-500',
}

export default function FrameworkPortalLayout() {
  const navigate = useNavigate()
  const [vendor, setVendor] = useState<VendorProfile | null>(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { navigate('/framework-portal/login'); return }
    getMyProfile().then(setVendor).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      navigate('/framework-portal/login')
    })
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: ACCENT }}>
          SP
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900 truncate">{vendor?.name || '…'}</div>
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[vendor?.status || 'invited']}`} />
            {vendor?.status === 'active' ? 'Active' : vendor?.status === 'pending_review' ? 'Under Review' : vendor?.status || '…'}
          </div>
        </div>
        {vendor?.has_badge && (
          <a
            href={vendor.badge_url || '#'}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            🪪 Badge
          </a>
        )}
      </div>

      {/* KYC notice banner */}
      {vendor && vendor.status === 'pending_review' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2">
          <span className="text-amber-600 text-xs">⏳</span>
          <span className="text-xs text-amber-700">
            Your documents are under review. You'll be notified once approved.
          </span>
        </div>
      )}

      {/* Page content */}
      <div className="flex-1 overflow-auto">
        <Outlet context={{ vendor, setVendor }} />
      </div>

      {/* Bottom navigation */}
      <nav className="bg-white border-t border-gray-100 flex items-stretch sticky bottom-0 z-30 safe-area-inset-bottom">
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
                isActive ? 'text-amber-600' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="text-xl leading-none">{n.icon}</span>
                <span className={`text-[10px] font-medium ${isActive ? 'text-amber-600' : 'text-gray-400'}`}>{n.label}</span>
                {isActive && <span className="w-1 h-1 rounded-full" style={{ backgroundColor: ACCENT }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
