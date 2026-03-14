import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { appsApi } from '@/api/apps'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { propertiesApi } from '@/api/properties'
import InstallAppModal from '@/components/InstallAppModal'
import { useToast } from '@/context/ToastContext'
import { usePropertyContext } from '@/context/PropertyContext'
import { APP_WAITLIST_KEY } from '@/constants/storage'
import type { InstalledApp } from '@/types/apps'
import type { InventoryConfig, StoreConfig } from '@/types/property'
import { storesApi } from '@/api/stores'
import type { StoreConfigUpdatePayload } from '@/types/store'

function loadLocalWaitlist(): Set<string> {
  try {
    const raw = localStorage.getItem(APP_WAITLIST_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveLocalWaitlist(set: Set<string>) {
  try {
    localStorage.setItem(APP_WAITLIST_KEY, JSON.stringify([...set]))
  } catch {
    // storage full — not critical
  }
}

type AppStatus = 'installed' | 'available' | 'coming_soon'
type AppCategory = 'AI' | 'Communication' | 'Finance' | 'Security' | 'Utility' | 'Legal'

interface AppDef {
  id: string
  name: string
  tagline: string
  description: string
  category: AppCategory
  icon: string
  status: AppStatus
  featured?: boolean
  badges?: string[]
  by?: string
  openPath?: string   // route to open when installed
  propertyLevel?: boolean  // true = per-property install via propertiesApi
}

const APPS: AppDef[] = [
  {
    id: 'whatsapp-notifications',
    name: 'WhatsApp Notifications',
    tagline: 'Connect WhatsApp numbers and receive messages in real time',
    description:
      'Link one or more WhatsApp numbers to your property. Receive tenant messages, send notifications, and monitor events in a live feed. Scan a QR code to connect each number — no extra apps needed.',
    category: 'Communication',
    icon: '💬',
    status: 'available',
    badges: ['Multi-line', 'QR Connect', 'Live Events', 'Real-time'],
    by: 'Nexidra',
    openPath: 'whatsapp',
    propertyLevel: true,
  },
  {
    id: 'voice-agent',
    name: 'Customer Agent',
    tagline: '24/7 virtual customer care agent for your property',
    description:
      'Give your tenants a dedicated customer care line that never sleeps. When a tenant calls, the agent instantly recognises the caller, pulls up their account, lease, and any open issues — then handles the conversation professionally. Tenants can pay rent, report maintenance problems, request statements, and get answers to common questions, all without waiting for office hours. Your team is only looped in when it truly matters.',
    category: 'AI',
    icon: '🤖',
    status: 'available',
    featured: true,
    badges: ['24/7 Support', 'Auto Payments', 'Ticket Logging', 'Instant Lookup'],
    by: 'Nexidra',
    openPath: 'apps/voice-agent',
  },
  {
    id: 'smart-lease-analyzer',
    name: 'Smart Lease Analyzer',
    tagline: 'AI review of lease terms and risk flags',
    description:
      'Automatically scans uploaded lease documents for non-standard clauses, missing terms, rent escalation triggers, and legal red flags — summarised in plain language.',
    category: 'AI',
    icon: '📑',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'rent-intelligence',
    name: 'Rent Price Intelligence',
    tagline: 'Market rent benchmarking for your units',
    description:
      'Compares your current rent levels against comparable units in the same area, surfacing over- and under-priced units with actionable recommendations.',
    category: 'AI',
    icon: '📊',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'maintenance-predictor',
    name: 'Maintenance Predictor',
    tagline: 'Predict maintenance issues before they happen',
    description:
      'Analyses ticket history and utility meter data to forecast likely maintenance events per unit, helping you plan proactively and reduce emergency costs.',
    category: 'AI',
    icon: '🔮',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'tenant-screening',
    name: 'Tenant Screening AI',
    tagline: 'AI-powered background and credit check',
    description:
      'Automated tenant vetting using AI analysis of provided documents, reference checks, and payment history scoring — integrated directly into the onboarding wizard.',
    category: 'AI',
    icon: '🔍',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'rent-reminders',
    name: 'Automated Rent Reminders',
    tagline: 'Smart SMS/email reminder sequences',
    description:
      'Configurable reminder schedules — 7 days before, on due date, and on overdue — sent via SMS and email with customisable message templates.',
    category: 'Communication',
    icon: '🔔',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'card-payments',
    name: 'Online Card Payments',
    tagline: 'Accept Visa/Mastercard from tenants',
    description:
      'Embedded card payment gateway allowing tenants to pay invoices directly from the tenant portal using debit or credit cards.',
    category: 'Finance',
    icon: '💳',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'property-valuation',
    name: 'Property Valuation',
    tagline: 'Automated market valuation for your portfolio',
    description:
      'Pulls comparable sales and rental data to generate an estimated market value for each property in your portfolio, updated monthly.',
    category: 'Finance',
    icon: '🏡',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'esign',
    name: 'Advanced E-Signature',
    tagline: 'Legally binding e-signatures for any document',
    description:
      'Integrate with DocuSign or HelloSign to send any custom document (addendums, notices) for legally binding electronic signature beyond the built-in lease workflow.',
    category: 'Legal',
    icon: '✍️',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'cctv',
    name: 'CCTV Integration',
    tagline: 'Live IP camera feeds, event alerts, and suspicious activity detection',
    description:
      'Connect ONVIF-compatible IP cameras to display live feeds and clips directly in the property dashboard. Configure sandbox mode to demo with YouTube streams. Events feed highlights suspicious activities with one-click video navigation. A 2-column camera widget appears on your property dashboard.',
    category: 'Security',
    icon: '📹',
    status: 'available',
    badges: ['ONVIF', 'Live Feed', 'Event Alerts', 'Sandbox Mode'],
    by: 'Nexidra',
    openPath: 'cctv',
    propertyLevel: true,
  },
  {
    id: 'energy',
    name: 'Energy Management',
    tagline: 'Smart meter integration and analytics',
    description:
      'Connect smart meters to automatically import utility readings, eliminating manual data entry and enabling real-time consumption dashboards.',
    category: 'Utility',
    icon: '⚡',
    status: 'coming_soon',
    by: 'Nexidra',
  },
  {
    id: 'inventory-assets',
    name: 'Inventory & Assets Management',
    tagline: 'Track stock, serials, variants, and physical assets',
    description:
      'Full inventory management with serialized items, weight tracking, merge/split operations, product variants with images, and asset lifecycle management. Configure per-property merge mode and split thresholds.',
    category: 'Utility',
    icon: '📦',
    status: 'available',
    by: 'Nexidra',
    openPath: 'inventory',
    propertyLevel: true,
  },
  {
    id: 'store-management',
    name: 'Store Management',
    tagline: 'Planogram-style warehouse and store segmentation',
    description:
      'Organise physical storage into a hierarchy of stores, aisles, bays, and faces — like a retail planogram. Track capacity, occupancy, and stock levels per zone. Assign responsible officers per location. Integrates with Inventory & Assets for precise stock placement.',
    category: 'Utility',
    icon: '🏭',
    status: 'available',
    by: 'Nexidra',
    openPath: 'stores',
    propertyLevel: true,
  },
  {
    id: 'smart-devices',
    name: 'Smart Devices',
    tagline: 'IoT device management, SSH access, OTA updates & telemetry alerts',
    description:
      'Register IoT devices from inventory, manage device lifecycle, monitor telemetry with threshold alerts, control SSH access with approval workflows, push OTA firmware updates, create device fleets for bulk operations, and manage security with certificate monitoring and device quarantine.',
    category: 'Utility' as AppCategory,
    icon: '📡',
    status: 'available' as AppStatus,
    openPath: 'smart-devices',
    propertyLevel: true,
  },
]

const CATEGORY_COLORS: Record<AppCategory, string> = {
  AI:            'bg-violet-100 text-violet-700',
  Communication: 'bg-blue-100 text-blue-700',
  Finance:       'bg-emerald-100 text-emerald-700',
  Security:      'bg-red-100 text-red-700',
  Utility:       'bg-amber-100 text-amber-700',
  Legal:         'bg-gray-100 text-gray-700',
}

const STATUS_COLORS: Record<AppStatus, string> = {
  installed:   'bg-emerald-100 text-emerald-700 border border-emerald-200',
  available:   'bg-blue-100 text-blue-700 border border-blue-200',
  coming_soon: 'bg-gray-100 text-gray-500 border border-gray-200',
}

const STATUS_LABEL: Record<AppStatus, string> = {
  installed:    'Installed',
  available:    'Available',
  coming_soon:  'Coming Soon',
}

// ─── Notify Me button ─────────────────────────────────────────────────────────

function NotifyMeButton({
  appId,
  initialNotified,
  onNotified,
}: {
  appId: string
  initialNotified: boolean
  onNotified: (appId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [notified, setNotified] = useState(initialNotified)
  const { showToast } = useToast()

  async function handle() {
    if (notified || loading) return
    setLoading(true)
    try {
      await appsApi.notifyMe(appId)
      setNotified(true)
      onNotified(appId)
      showToast("You're on the waitlist! We'll notify you when this app launches.", 'success')
    } catch {
      showToast('Failed to subscribe. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (notified) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium cursor-default select-none">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Subscribed
      </span>
    )
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className="text-xs font-medium text-gray-500 hover:text-violet-700 border border-gray-200 hover:border-violet-300 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
    >
      {loading ? 'Saving…' : 'Notify me'}
    </button>
  )
}

// ─── Customer Agent Detail Panel ─────────────────────────────────────────────

function CustomerAgentPanel({
  app,
  installed,
  onInstallClick,
  onOpenClick,
  onConfigureClick,
}: {
  app: AppDef
  installed: boolean
  onInstallClick: () => void
  onOpenClick: () => void
  onConfigureClick: () => void
}) {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const effectiveStatus: AppStatus = installed ? 'installed' : 'available'

  return (
    <div className="mb-10 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 overflow-hidden shadow-sm">
      <div className="p-6 sm:p-8 flex flex-col lg:flex-row gap-8">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <span className="text-2xl">{app.icon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">{app.name}</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white">FEATURED</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[effectiveStatus]}`}>
                  {STATUS_LABEL[effectiveStatus]}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-0.5">{app.tagline}</p>
            </div>
          </div>

          <p className="text-sm text-gray-700 leading-relaxed mb-5">{app.description}</p>

          {/* Mode selector — only visible when not installed */}
          {!installed && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-700 mb-2">Operation Mode</p>
              <div className="inline-flex bg-white border border-gray-200 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setMode('manual')}
                  className={[
                    'px-4 py-2 text-xs font-semibold rounded-md transition-all',
                    mode === 'manual' ? 'bg-gray-900 text-white shadow' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  Manual (popup)
                </button>
                <button
                  onClick={() => setMode('auto')}
                  className={[
                    'px-4 py-2 text-xs font-semibold rounded-md transition-all',
                    mode === 'auto' ? 'bg-violet-600 text-white shadow' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  Auto (AI answers)
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {mode === 'manual'
                  ? 'When a tenant calls, your team gets an instant screen pop showing who is calling, their balance, and open issues — so every call is answered informed.'
                  : 'The agent handles the entire call end-to-end: greets the tenant, resolves their query, and only escalates to your team when human judgement is needed.'}
              </p>
            </div>
          )}

          {/* Tech badges */}
          <div className="flex flex-wrap gap-2 mb-6">
            {app.badges?.map((b) => (
              <span key={b} className="text-xs font-medium px-2.5 py-1 rounded-full bg-white border border-violet-200 text-violet-700">
                {b}
              </span>
            ))}
          </div>

          {/* Actions */}
          {installed ? (
            <div className="flex gap-3">
              <button
                onClick={onOpenClick}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm"
              >
                Open App →
              </button>
              <button
                onClick={onConfigureClick}
                className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-colors shadow-sm"
              >
                Configure
              </button>
            </div>
          ) : (
            <button
              onClick={onInstallClick}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors shadow-sm"
            >
              Set Up Customer Agent
            </button>
          )}
        </div>

        {/* Right: how-it-works */}
        <div className="lg:w-72 shrink-0">
          <div className="bg-white rounded-xl border border-violet-100 p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-4">How it works</p>
            <ol className="space-y-4">
              {[
                { step: '1', icon: '📞', label: 'Tenant calls your dedicated property number' },
                { step: '2', icon: '🔍', label: 'Agent recognises the caller and pulls up their account instantly' },
                { step: '3', icon: '💬', label: 'Agent handles rent payments, maintenance requests, and account queries' },
                { step: '4', icon: '📋', label: 'Every call is logged with a full summary for your records' },
              ].map((s) => (
                <li key={s.step} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center shrink-0 text-violet-700 text-xs font-bold">
                    {s.step}
                  </div>
                  <div>
                    <span className="text-sm mr-1.5">{s.icon}</span>
                    <span className="text-xs text-gray-600">{s.label}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-2">What tenants can do</p>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>• Pay rent and get payment confirmations</li>
                <li>• Report maintenance issues</li>
                <li>• Request account statements</li>
                <li>• Ask about their lease and balance</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Generic App Card ─────────────────────────────────────────────────────────

function AppCard({
  app,
  installed,
  notified,
  onOpenClick,
  onConfigureClick,
  onInstallClick,
  onUninstallClick,
  onNotified,
}: {
  app: AppDef
  installed: boolean
  notified: boolean
  onOpenClick: () => void
  onConfigureClick: () => void
  onInstallClick?: () => void
  onUninstallClick?: () => void
  onNotified: (appId: string) => void
}) {
  const effectiveStatus: AppStatus = installed ? 'installed' : app.status

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center text-xl shrink-0">
          {app.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{app.name}</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[effectiveStatus]}`}>
              {STATUS_LABEL[effectiveStatus]}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{app.tagline}</p>
        </div>
      </div>

      <p className="text-xs text-gray-500 leading-relaxed flex-1 mb-4 line-clamp-3">{app.description}</p>

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[app.category]}`}>
          {app.category}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {installed ? (
            <>
              {app.openPath && (
                <>
                  <button
                    onClick={onOpenClick}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 transition-colors"
                  >
                    Open →
                  </button>
                  <span className="text-gray-200">|</span>
                </>
              )}
              <button
                onClick={onConfigureClick}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Configure
              </button>
              {app.propertyLevel && (
                <>
                  <span className="text-gray-200">|</span>
                  <button
                    onClick={onUninstallClick}
                    className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors"
                  >
                    Uninstall
                  </button>
                </>
              )}
            </>
          ) : effectiveStatus === 'available' ? (
            <button
              onClick={app.propertyLevel ? onInstallClick : undefined}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              Install →
            </button>
          ) : (
            <NotifyMeButton appId={app.id} initialNotified={notified} onNotified={onNotified} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Inventory Configure Panel ────────────────────────────────────────────────

function InventoryConfigurePanel({
  propertyId,
  initial,
  onClose,
  onSaved,
}: {
  propertyId: string
  initial: InventoryConfig
  onClose: () => void
  onSaved: () => void
}) {
  const [mergeMode, setMergeMode] = useState<'keep_target' | 'create_new'>(initial.serial_merge_mode)
  const [splitPct, setSplitPct] = useState(String(initial.serial_split_remainder_pct))
  const [showWeight, setShowWeight] = useState(initial.show_weight_tracking ?? true)
  const [decimalPlaces, setDecimalPlaces] = useState(initial.decimal_places ?? 2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      await propertiesApi.updateInventoryConfig(propertyId, {
        serial_merge_mode: mergeMode,
        serial_split_remainder_pct: parseFloat(splitPct) || 0,
        show_weight_tracking: showWeight,
        decimal_places: decimalPlaces,
      })
      await onSaved()
      showToast('Inventory configuration saved', 'success')
      onClose()
    } catch {
      setError('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📦</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Inventory & Assets</h2>
              <p className="text-xs text-gray-500">Configure serial merge & split settings</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Serial merge mode */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Serial Merge Mode</h3>
            <p className="text-xs text-gray-500 mb-3">
              When merging two serials, determines what happens to the resulting serial number.
            </p>
            <div className="space-y-2">
              {([
                { value: 'keep_target', label: 'Keep target serial', desc: 'The merged result keeps the target serial\'s number. Source serial is retired.' },
                { value: 'create_new', label: 'Create new serial', desc: 'A new serial number is generated for the merged result. Both source serials are retired.' },
              ] as const).map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${mergeMode === opt.value ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" className="mt-0.5" checked={mergeMode === opt.value} onChange={() => setMergeMode(opt.value)} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Split remainder threshold */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Split Remainder Threshold</h3>
            <p className="text-xs text-gray-500 mb-3">
              When splitting a serial, any remainder below this percentage of the original net quantity is absorbed into the largest child serial rather than creating a tiny leftover serial.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                className="input w-32 text-sm"
                value={splitPct}
                onChange={e => setSplitPct(e.target.value)}
              />
              <span className="text-sm text-gray-600">% of original net quantity</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Typical value: 5% — remainders below this are not split into a separate serial.</p>
          </div>

          {/* Weight tracking visibility */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Weight / Qty Tracking Fields</h3>
            <p className="text-xs text-gray-500 mb-3">
              When disabled, weight/quantity input fields are hidden in stock-in and stock-out for this property. Variance flags and audit records are still maintained.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setShowWeight(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showWeight ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${showWeight ? 'translate-x-6' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm text-gray-700">{showWeight ? 'Show weight / qty fields' : 'Hide weight / qty fields'}</span>
            </label>
          </div>

          {/* Decimal places */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Decimal Places</h3>
            <p className="text-xs text-gray-500 mb-3">
              Number of decimal places for displaying and rounding quantities, weights, and volumes in this property's inventory.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" step="1" min="0" max="6"
                className="input w-24 text-sm"
                value={decimalPlaces}
                onChange={e => setDecimalPlaces(Math.max(0, Math.min(6, parseInt(e.target.value) || 0)))}
              />
              <span className="text-sm text-gray-600">decimal places</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors"
          >
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Store Configure Panel ─────────────────────────────────────────────────────

const CAPACITY_UNITS = ['units', 'kg', 'pallets', 'boxes', 'litres', 'sqm']

function StoreConfigurePanel({
  propertyId,
  initial,
  onClose,
  onSaved,
}: {
  propertyId: string
  initial: StoreConfig
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<StoreConfigUpdatePayload>({
    allow_segmentation: initial.allow_segmentation,
    allow_labelling: initial.allow_labelling,
    allow_owner_assignment: initial.allow_owner_assignment,
    default_capacity_unit: initial.default_capacity_unit,
  })
  const { showToast } = useToast()

  async function handleSave() {
    setSaving(true)
    try {
      await storesApi.updateConfig(propertyId, cfg)
      await onSaved()
      showToast('Store configuration saved', 'success')
      onClose()
    } catch {
      showToast('Failed to save configuration', 'error')
    } finally {
      setSaving(false)
    }
  }

  function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        <div onClick={() => onChange(!value)} className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors ${value ? 'bg-blue-600' : 'bg-gray-200'}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏭</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Store Management</h2>
              <p className="text-xs text-gray-500">Configure store segmentation and defaults</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <Toggle label="Allow Segmentation" desc="Enable aisle → bay → face hierarchy for stores." value={cfg.allow_segmentation!} onChange={v => setCfg(p => ({ ...p, allow_segmentation: v }))} />
          <Toggle label="Allow Labelling" desc="Allow custom labels and planogram codes per zone." value={cfg.allow_labelling!} onChange={v => setCfg(p => ({ ...p, allow_labelling: v }))} />
          <Toggle label="Officer Assignment" desc="Allow assigning a responsible officer to each zone." value={cfg.allow_owner_assignment!} onChange={v => setCfg(p => ({ ...p, allow_owner_assignment: v }))} />
          <div>
            <p className="text-sm font-medium text-gray-800 mb-1">Default Capacity Unit</p>
            <p className="text-xs text-gray-500 mb-2">Applied when creating new stores and zones.</p>
            <select className="input text-sm" value={cfg.default_capacity_unit} onChange={e => setCfg(p => ({ ...p, default_capacity_unit: e.target.value }))}>
              {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PropertyAppsPage() {
  const navigate = useNavigate()
  const { propertyId } = useParams<{ propertyId: string }>()
  const { property, refreshProperty } = usePropertyContext()
  const appPath = (rel: string) => `/properties/${propertyId}/${rel}`
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<AppCategory | 'all'>('all')
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [waitlist, setWaitlist] = useState<Set<string>>(loadLocalWaitlist)
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [propertyAppLoading, setPropertyAppLoading] = useState<string | null>(null)
  const [showInventoryConfigure, setShowInventoryConfigure] = useState(false)
  const [showStoreConfigure, setShowStoreConfigure] = useState(false)

  useEffect(() => {
    appsApi.list().then((r) => setInstalledApps(r.items)).catch(() => {})
    appsApi.getWaitlist().then((r) => {
      setWaitlist((prev) => {
        const merged = new Set([...prev, ...r.app_ids])
        saveLocalWaitlist(merged)
        return merged
      })
    }).catch(() => {})
  }, [])

  function handleNotified(appId: string) {
    setWaitlist((prev) => {
      const next = new Set([...prev, appId])
      saveLocalWaitlist(next)
      return next
    })
  }

  // For org-level apps (voice-agent) check via appsApi
  const isOrgAppInstalled = (appId: string) =>
    installedApps.some((a) => a.app_id === appId && a.status === 'active')

  // For property-level apps (inventory-assets) check via property.installed_apps
  const isPropertyAppInstalled = (appId: string) =>
    property?.installed_apps?.includes(appId) ?? false

  const isInstalled = (app: AppDef) =>
    app.propertyLevel ? isPropertyAppInstalled(app.id) : isOrgAppInstalled(app.id)

  async function handlePropertyInstall(appId: string) {
    if (!propertyId || propertyAppLoading) return
    setPropertyAppLoading(appId)
    try {
      await propertiesApi.installApp(propertyId, appId)
      await refreshProperty()
      showToast('App installed successfully', 'success')
    } catch {
      showToast('Failed to install app', 'error')
    } finally {
      setPropertyAppLoading(null)
    }
  }

  async function handlePropertyUninstall(appId: string) {
    if (!propertyId || propertyAppLoading) return
    setPropertyAppLoading(appId)
    try {
      await propertiesApi.uninstallApp(propertyId, appId)
      await refreshProperty()
      showToast('App uninstalled', 'success')
    } catch {
      showToast('Failed to uninstall app', 'error')
    } finally {
      setPropertyAppLoading(null)
    }
  }

  const featuredApp = APPS.find((a) => a.featured)!
  const otherApps = APPS.filter((a) => !a.featured).filter((a) => {
    const q = search.toLowerCase().trim()
    const matchesSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    const matchesCategory = categoryFilter === 'all' || a.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const categories: (AppCategory | 'all')[] = [
    'all', 'AI', 'Communication', 'Finance', 'Security', 'Utility', 'Legal',
  ]

  function handleInstalled(app: InstalledApp) {
    setInstalledApps((prev) => [...prev.filter((a) => a.app_id !== app.app_id), app])
    setShowInstallModal(false)
    navigate(appPath('apps/voice-agent'))
  }

  const customerAgentInstalled = isOrgAppInstalled('voice-agent')

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PropertyBreadcrumb page="Apps" />
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">App Marketplace</h1>
        <p className="text-sm text-gray-500 mt-1">
          Extend your property management platform with AI, communication, and financial integrations.
        </p>
      </div>

      {/* Featured: Customer Agent */}
      <CustomerAgentPanel
        app={featuredApp}
        installed={customerAgentInstalled}
        onInstallClick={() => setShowInstallModal(true)}
        onOpenClick={() => navigate(appPath('apps/voice-agent'))}
        onConfigureClick={() => navigate(appPath('apps/voice-agent') + '?tab=config')}
      />

      {/* Browse heading + filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-gray-900">Browse All Apps</h2>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="pl-8 pr-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as AppCategory | 'all')}
            className="px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
            ))}
          </select>
        </div>
      </div>

      {otherApps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-sm text-gray-500">No apps match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {otherApps.map((app) => {
            const installed = isInstalled(app)
            return (
              <AppCard
                key={app.id}
                app={app}
                installed={installed}
                notified={waitlist.has(app.id)}
                onOpenClick={() => app.openPath && navigate(appPath(app.openPath))}
                onConfigureClick={() => {
                  if (app.id === 'inventory-assets') { setShowInventoryConfigure(true); return }
                  if (app.id === 'store-management') { setShowStoreConfigure(true); return }
                  if (app.openPath) navigate(appPath(app.openPath) + '?tab=config')
                }}
                onInstallClick={() => handlePropertyInstall(app.id)}
                onUninstallClick={() => handlePropertyUninstall(app.id)}
                onNotified={handleNotified}
              />
            )
          })}
        </div>
      )}

      {showInstallModal && (
        <InstallAppModal
          onInstalled={handleInstalled}
          onClose={() => setShowInstallModal(false)}
        />
      )}

      {showInventoryConfigure && propertyId && property?.inventory_config && (
        <InventoryConfigurePanel
          propertyId={propertyId}
          initial={property.inventory_config}
          onClose={() => setShowInventoryConfigure(false)}
          onSaved={refreshProperty}
        />
      )}

      {showStoreConfigure && propertyId && property?.store_config && (
        <StoreConfigurePanel
          propertyId={propertyId}
          initial={property.store_config}
          onClose={() => setShowStoreConfigure(false)}
          onSaved={refreshProperty}
        />
      )}
    </div>
  )
}
