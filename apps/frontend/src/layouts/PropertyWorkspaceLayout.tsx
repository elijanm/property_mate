import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/context/ToastContext'
import { SIDEBAR_BACK_LINK_POSITION } from '@/constants/layout'
import TopBar from '@/components/TopBar'
import type { Property } from '@/types/property'

interface NavChild {
  label: string
  path: string
  comingSoon?: boolean
  exact?: boolean
}

interface NavItem {
  label: string
  path: string
  icon: string
  exact?: boolean
  children?: NavChild[]
  isHeader?: boolean // renders as non-link section header; children always visible
}

// Registry of all known installable apps: id → display info
interface AppMeta {
  label: string
  icon: string
  /** path relative to /properties/:id/ */
  path: string
}

const APP_REGISTRY: Record<string, AppMeta> = {
  'voice-agent':            { label: 'Customer Agent',          icon: '🤖', path: 'apps/voice-agent' },
  'whatsapp-notifications': { label: 'WhatsApp Notifications',  icon: '💬', path: 'whatsapp' },
  'inventory-assets':       { label: 'Inventory & Assets',      icon: '📦', path: 'inventory' },
  'store-management':       { label: 'Store Management',        icon: '🏪', path: 'stores' },
  'smart-devices':          { label: 'Smart Devices',           icon: '📡', path: 'smart-devices' },
  'cctv':                   { label: 'CCTV',                    icon: '📹', path: 'cctv' },
}

// --- Frequency tracking (per-property in localStorage) ---
const FREQ_KEY_PREFIX = 'pms_app_freq_'

function loadFreq(propertyId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(FREQ_KEY_PREFIX + propertyId)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function incFreq(propertyId: string, appId: string): void {
  try {
    const freq = loadFreq(propertyId)
    freq[appId] = (freq[appId] ?? 0) + 1
    localStorage.setItem(FREQ_KEY_PREFIX + propertyId, JSON.stringify(freq))
  } catch {
    // non-critical
  }
}

const BASE_NAV: NavItem[] = [
  { label: 'Dashboard', path: '', icon: '◫', exact: true },
  { label: 'Units',     path: '/units', icon: '🏠' },
  {
    label: 'Leasing',
    path: '/leasing',
    icon: '🔑',
    isHeader: true,
    children: [
      { label: 'Tenants',      path: '/tenants' },
      { label: 'Leases',       path: '/leases' },
      { label: 'Applications', path: '/leasing/applications', comingSoon: true },
      { label: 'Screening',    path: '/leasing/screening',    comingSoon: true },
      { label: 'Renewals',     path: '/leasing/renewals',     comingSoon: true },
    ],
  },
  {
    label: 'Accounting',
    path: '/accounting',
    icon: '💰',
    isHeader: true,
    children: [
      { label: 'Overview',         path: '/accounting', exact: true },
      { label: 'Prepare Invoices', path: '/accounting/invoices' },
      { label: 'Summary',          path: '/accounting/summary' },
    ],
  },
  {
    label: 'Maintenance',
    path: '/maintenance',
    icon: '🔧',
    isHeader: true,
    children: [
      { label: 'Tickets',      path: '/tickets' },
      { label: 'Work Orders',  path: '/maintenance/work-orders', comingSoon: true },
      { label: 'Inspections',  path: '/maintenance/inspections', comingSoon: true },
    ],
  },
  {
    label: 'Resources',
    path: '/resources',
    icon: '📦',
    isHeader: true,
    children: [
      { label: 'Vendors', path: '/service-providers' },
    ],
  },
  { label: 'Reports',  path: '/reports',  icon: '📊' },
  { label: 'Settings', path: '/settings', icon: '⚙' },
]

const PARKING_NAV: NavItem = { label: 'Parking', path: '/parking', icon: '🅿' }

function buildNav(property: Property): NavItem[] {
  const resourceChildren: NavChild[] = [
    { label: 'Vendors', path: '/service-providers' },
  ]
  if (property.installed_apps?.includes('inventory-assets')) {
    resourceChildren.push(
      { label: 'Assets',    path: '/assets' },
      { label: 'Inventory', path: '/inventory' },
    )
  }
  if (property.installed_apps?.includes('store-management')) {
    resourceChildren.push({ label: 'Stores', path: '/stores' })
  }
  if (property.installed_apps?.includes('smart-devices')) {
    resourceChildren.push({ label: 'Smart Devices', path: '/smart-devices' })
  }
  if (property.installed_apps?.includes('cctv')) {
    resourceChildren.push({ label: 'CCTV', path: '/cctv' })
  }

  let nav: NavItem[] = BASE_NAV.map((item) =>
    item.path === '/resources'
      ? { ...item, children: resourceChildren }
      : item,
  )

  if (property.unit_policies?.parking_available) {
    const settingsIdx = nav.findIndex((i) => i.path === '/settings')
    nav.splice(settingsIdx, 0, PARKING_NAV)
  }
  return nav
}

// ─── Apps popover ────────────────────────────────────────────────────────────

interface AppsMenuProps {
  property: Property
  base: string
  color: string
}

function AppsMenu({ property, base, color }: AppsMenuProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const clickedInsideButton = ref.current?.contains(e.target as Node)
      const clickedInsideDropdown = dropdownRef.current?.contains(e.target as Node)
      if (!clickedInsideButton && !clickedInsideDropdown) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Focus search input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else setQuery('')
  }, [open])

  const installed = property.installed_apps ?? []
  const freq = loadFreq(property.id)

  // Sort: by frequency desc, then alphabetically
  const sorted = [...installed]
    .filter((id) => APP_REGISTRY[id])
    .sort((a, b) => {
      const diff = (freq[b] ?? 0) - (freq[a] ?? 0)
      return diff !== 0 ? diff : (APP_REGISTRY[a].label < APP_REGISTRY[b].label ? -1 : 1)
    })

  const filtered = query
    ? sorted.filter((id) =>
        APP_REGISTRY[id].label.toLowerCase().includes(query.toLowerCase()),
      )
    : sorted

  const isAnyAppActive = installed.some((id) => {
    const meta = APP_REGISTRY[id]
    return meta && pathname.startsWith(`${base}/${meta.path}`)
  })

  function handleOpen() {
    if (!ref.current) { setOpen((o) => !o); return }
    const rect = ref.current.getBoundingClientRect()
    // Dropdown height ~320px max — position above button if near bottom of screen
    const dropdownH = 320
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const top = spaceBelow >= dropdownH ? rect.bottom + 4 : rect.top - dropdownH - 4
    setMenuPos({ left: rect.right + 8, top: Math.max(8, top) })
    setOpen((o) => !o)
  }

  function handleAppClick(appId: string) {
    const meta = APP_REGISTRY[appId]
    if (!meta) return
    incFreq(property.id, appId)
    setOpen(false)
    navigate(`${base}/${meta.path}`)
  }

  return (
    <div ref={ref}>
      <button
        onClick={handleOpen}
        className={[
          'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isAnyAppActive || open
            ? 'text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        ].join(' ')}
        style={isAnyAppActive || open ? { backgroundColor: color } : undefined}
      >
        <span className="w-4 text-center text-sm">🧩</span>
        <span className="flex-1 text-left">Apps</span>
        {installed.length > 0 && (
          <span
            className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 min-w-[18px] text-center"
            style={
              isAnyAppActive || open
                ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                : { background: '#e5e7eb', color: '#6b7280' }
            }
          >
            {installed.length}
          </span>
        )}
      </button>

      {open && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
          className="w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {/* Search */}
          <div className="px-3 pt-3 pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
              <span className="text-gray-400 text-xs">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps…"
                className="flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-400 outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500 text-xs">
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* App list */}
          <div className="py-1.5 max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400 text-center">
                {installed.length === 0 ? 'No apps installed' : 'No apps match'}
              </p>
            ) : (
              filtered.map((appId) => {
                const meta = APP_REGISTRY[appId]
                const appPath = `${base}/${meta.path}`
                const isActive = pathname.startsWith(appPath)
                return (
                  <button
                    key={appId}
                    onClick={() => handleAppClick(appId)}
                    className={[
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                      isActive ? 'bg-gray-50' : '',
                    ].join(' ')}
                  >
                    <span className="text-base leading-none">{meta.icon}</span>
                    <span
                      className="text-xs font-medium truncate"
                      style={isActive ? { color } : { color: '#374151' }}
                    >
                      {meta.label}
                    </span>
                    {(freq[appId] ?? 0) > 0 && (
                      <span className="ml-auto text-[9px] text-gray-300 tabular-nums">
                        {freq[appId]}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Footer: go to Apps page */}
          <div className="border-t border-gray-100">
            <button
              onClick={() => { setOpen(false); navigate(`${base}/apps`) }}
              className="w-full px-3 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-left"
            >
              Manage apps →
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#2563eb', // blue
  '#7c3aed', // violet
  '#059669', // emerald
  '#d97706', // amber
  '#e11d48', // rose
  '#0891b2', // cyan
  '#ea580c', // orange
  '#4338ca', // indigo
  '#0d9488', // teal
  '#db2777', // pink
]

export function getPropertyColor(property: Property, index = 0): string {
  if (property.color) return property.color
  return PRESET_COLORS[index % PRESET_COLORS.length]
}

interface Props {
  property: Property
  children: React.ReactNode
}

function CollapsibleSection({
  item,
  base,
  color,
  pathname,
}: {
  item: NavItem
  base: string
  color: string
  pathname: string
}) {
  const { showToast } = useToast()
  const anyChildActive = item.children!.some(
    (c) => !c.comingSoon && (c.exact ? pathname === base + c.path : pathname.startsWith(base + c.path)),
  )
  const [open, setOpen] = useState(anyChildActive)

  // Auto-expand when a child becomes active (e.g. direct URL navigation)
  if (anyChildActive && !open) setOpen(true)

  return (
    <div className="pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
          anyChildActive ? 'text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        ].join(' ')}
      >
        <span className="w-4 text-center text-sm">{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        <span
          className={[
            'text-xs text-gray-400 transition-transform duration-200',
            open ? 'rotate-90' : '',
          ].join(' ')}
        >
          ›
        </span>
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {item.children!.map((child) => {
            const childPath = base + child.path
            const childActive = !child.comingSoon && (child.exact ? pathname === childPath : pathname.startsWith(childPath))

            if (child.comingSoon) {
              return (
                <button
                  key={child.path}
                  onClick={() => showToast(`${child.label} is coming soon`, 'info')}
                  className="w-full flex items-center justify-between rounded-lg pl-7 pr-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-50 hover:text-gray-500 transition-colors"
                >
                  {child.label}
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                    Soon
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={child.path}
                to={childPath}
                className={[
                  'flex items-center gap-3 rounded-lg pl-7 pr-3 py-2 text-sm font-medium transition-colors',
                  childActive ? 'text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                ].join(' ')}
                style={childActive ? { backgroundColor: color } : undefined}
              >
                {child.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function PropertyWorkspaceLayout({ property, children }: Props) {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const base = `/portfolio/properties/${property.id}`
  const color = getPropertyColor(property)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Property sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
        {/* Back + logo */}
        <div className="px-4 py-3 border-b border-gray-100">
          {SIDEBAR_BACK_LINK_POSITION === 'above-logo' && (
            <button
              onClick={() => navigate('/portfolio/properties')}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3"
            >
              ← Real Estate
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
              <span className="text-white text-xs font-bold">{property.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{property.name}</p>
              <p className="text-[10px] text-gray-400 capitalize">{property.property_type}</p>
            </div>
          </div>
        </div>

        {/* Property nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {SIDEBAR_BACK_LINK_POSITION === 'below-logo' && (
            <>
              <button
                onClick={() => navigate('/portfolio/properties')}
                className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <span className="w-4 text-center text-sm">←</span>
                Real Estate
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          {buildNav(property).map((item) => {
            const fullPath = base + item.path
            const isActive = item.exact ? pathname === fullPath : pathname.startsWith(fullPath)

            if (item.isHeader && item.children) {
              return (
                <CollapsibleSection
                  key={item.path}
                  item={item}
                  base={base}
                  color={color}
                  pathname={pathname}
                />
              )
            }

            return (
              <div key={item.path}>
                <Link
                  to={fullPath}
                  className={[
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: color } : undefined}
                >
                  <span className="w-4 text-center text-sm">{item.icon}</span>
                  {item.label}
                </Link>
              </div>
            )
          })}

          {/* Apps menu — always rendered after the main nav */}
          <AppsMenu property={property} base={base} color={color} />
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
        <TopBar propertyId={property.id} propertyName={property.name} />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

export { PRESET_COLORS }
