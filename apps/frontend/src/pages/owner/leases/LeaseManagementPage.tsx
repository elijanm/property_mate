import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leasesApi } from '@/api/leases'
import { unitsApi } from '@/api/units'
import { propertiesApi } from '@/api/properties'
import { onboardingsApi } from '@/api/onboardings'
import { tenantsApi } from '@/api/tenants'
import { paymentsApi } from '@/api/payments'
import { extractApiError } from '@/utils/apiError'
import { useMfaSession } from '@/hooks/useMfaSession'
import { maskEmail, maskPhone } from '@/utils/maskPii'
import MfaPinModal from '@/components/MfaPinModal'
import LeaseDetailSlideOver from '@/components/LeaseDetailSlideOver'
import type { Lease, LeaseCreateRequest, TenantCreateInline } from '@/types/lease'
import type { Unit, UnitPricingResponse } from '@/types/unit'
import type { Tenant } from '@/types/tenant'
import type { OnboardingResponse } from '@/api/onboardings'
import type { PaymentSummary } from '@/types/payment'

const STATUS_COLORS: Record<string, string> = {
  draft:             'bg-gray-100 text-gray-700',
  pending_payment:   'bg-yellow-100 text-yellow-800',
  pending_signature: 'bg-blue-100 text-blue-800',
  active:            'bg-green-100 text-green-800',
  expired:           'bg-orange-100 text-orange-700',
  terminated:        'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  draft:             'Draft',
  pending_payment:   'Pending Payment',
  pending_signature: 'Awaiting Signature',
  active:            'Active',
  expired:           'Expired',
  terminated:        'Terminated',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.round(diff / 86_400_000)
}

function expiryLabel(days: number | null): { text: string; cls: string } {
  if (days === null) return { text: 'Rolling', cls: 'text-gray-400' }
  if (days < 0)  return { text: `Expired ${Math.abs(days)}d ago`, cls: 'text-red-600 font-medium' }
  if (days === 0) return { text: 'Expires today', cls: 'text-red-600 font-semibold' }
  if (days <= 14) return { text: `${days} days left`, cls: 'text-orange-500 font-medium' }
  if (days <= 60) return { text: `${days} days left`, cls: 'text-yellow-600' }
  return { text: `${days} days left`, cls: 'text-green-600' }
}

// 'invite' = create tenant account + auto-send onboarding email (no password needed from owner)
type TenantMode = 'existing' | 'invite' | 'create'

const EMPTY_INLINE: TenantCreateInline = {
  email: '', first_name: '', last_name: '', phone: '', password: '',
}

function addOneYear(date: string): string {
  if (!date) return ''
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().split('T')[0]
}

// Small random temp password for invite-mode tenant creation (they'll reset via invite link)
function tempPassword(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</p>
  )
}

const PAGE_SIZE = 20

const TABS = [
  { key: 'all',                label: 'All' },
  { key: 'active',             label: 'Active' },
  { key: 'draft',              label: 'Draft' },
  { key: 'pending_payment',    label: 'Pending Payment' },
  { key: 'pending_signature',  label: 'Awaiting Signature' },
  { key: 'expired',            label: 'Expired' },
  { key: 'terminated',         label: 'Terminated' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function LeaseManagementPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()
  const { isUnlocked, unlock } = useMfaSession()
  const [showMfa, setShowMfa] = useState(false)
  const [propertyName, setPropertyName] = useState('')
  const [leases, setLeases] = useState<Lease[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [vacantUnits, setVacantUnits] = useState<Unit[]>([])
  const [allTenants, setAllTenants] = useState<Tenant[]>([])
  const [tenantsLoading, setTenantsLoading] = useState(false)
  // Filters
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // Lookup maps populated on load
  const [tenantMap, setTenantMap] = useState<Map<string, Tenant>>(new Map())
  const [onboardingByLease, setOnboardingByLease] = useState<Map<string, OnboardingResponse>>(new Map())
  const [paymentMap, setPaymentMap] = useState<Map<string, PaymentSummary>>(new Map())

  // Lease form
  const [tenantMode, setTenantMode] = useState<TenantMode>('existing')
  const [form, setForm] = useState<Omit<LeaseCreateRequest, 'tenant_id' | 'tenant_create'>>({
    unit_id: '', start_date: '', rent_amount: 0, deposit_amount: 0,
    utility_deposit: undefined, notes: '',
  })
  const [tenantId, setTenantId] = useState('')
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantCreate, setTenantCreate] = useState<TenantCreateInline>(EMPTY_INLINE)
  const [pricing, setPricing] = useState<UnitPricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [createdOnboardingToken, setCreatedOnboardingToken] = useState<string | null>(null)

  // Slide-over
  const [selectedLease, setSelectedLease] = useState<Lease | null>(null)

  // Context-action dropdown (portal)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null); setMenuPos(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Row-level invite modal
  const [inviteLeaseId, setInviteLeaseId] = useState<string | null>(null)
  const [inviteOnboardingId, setInviteOnboardingId] = useState<string | null>(null)
  const [rowInviteEmail, setRowInviteEmail] = useState('')
  const [rowInviteLoading, setRowInviteLoading] = useState(false)
  const [rowInviteError, setRowInviteError] = useState<string | null>(null)

  useEffect(() => {
    if (!propertyId) return
    propertiesApi.get(propertyId).then((p) => setPropertyName(p.name)).catch(() => {})
  }, [propertyId])

  async function enrichLeases(newLeases: Lease[], append: boolean) {
    // Update tenant map with any new tenants
    const missingIds = newLeases.map((l) => l.tenant_id).filter((id) => id && !tenantMap.has(id))
    if (missingIds.length > 0) {
      const tr = await tenantsApi.list({ page_size: 100 }).catch(() => ({ items: [] as Tenant[], total: 0 }))
      setTenantMap((prev) => {
        const m = new Map(prev)
        tr.items.forEach((t) => m.set(t.id, t))
        return m
      })
    }
    // Payment summaries
    const pmEntries = await Promise.all(
      newLeases.map((l) =>
        paymentsApi.list(l.id).then((s) => [l.id, s] as const).catch(() => null)
      )
    )
    setPaymentMap((prev) => {
      const m = new Map(append ? prev : new Map<string, PaymentSummary>())
      pmEntries.forEach((entry) => { if (entry) m.set(entry[0], entry[1]) })
      return m
    })
  }

  async function load(tab: TabKey = activeTab, pg: number = 1) {
    if (!propertyId) return
    if (pg === 1) setLoading(true)
    else setLoadingMore(true)
    try {
      const status = tab === 'all' ? undefined : tab
      const [leasesRes, tenantsRes, onboardingsRes] = await Promise.all([
        leasesApi.list(propertyId, { status, page: pg, page_size: PAGE_SIZE }),
        pg === 1
          ? tenantsApi.list({ page_size: 100 }).catch(() => ({ items: [] as Tenant[], total: 0 }))
          : Promise.resolve(null),
        pg === 1
          ? onboardingsApi.list({ property_id: propertyId, page: 1 }).catch(() => ({ items: [] as OnboardingResponse[], total: 0 }))
          : Promise.resolve(null),
      ])

      if (pg === 1) {
        setLeases(leasesRes.items)
        if (tenantsRes) {
          const tm = new Map<string, Tenant>()
          tenantsRes.items.forEach((t) => tm.set(t.id, t))
          setTenantMap(tm)
          setAllTenants(tenantsRes.items)
        }
        if (onboardingsRes) {
          const obm = new Map<string, OnboardingResponse>()
          onboardingsRes.items.forEach((ob) => { if (ob.lease_id) obm.set(ob.lease_id, ob) })
          setOnboardingByLease(obm)
        }
      } else {
        setLeases((prev) => [...prev, ...leasesRes.items])
      }

      setTotal(leasesRes.total)
      setPage(pg)
      await enrichLeases(leasesRes.items, pg > 1)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab)
    setSearchQuery('')
    load(tab, 1)
  }

  function loadMore() {
    load(activeTab, page + 1)
  }

  async function loadFormData() {
    if (!propertyId) return
    setTenantsLoading(true)
    const [reserved, vacant, tenantRes] = await Promise.all([
      unitsApi.list(propertyId, { status: 'reserved', page_size: 100 }),
      unitsApi.list(propertyId, { status: 'vacant', page_size: 100 }),
      tenantsApi.list({ page_size: 100 }).catch(() => ({ items: [] as Tenant[], total: 0 })),
    ])
    setVacantUnits([...reserved.items, ...vacant.items])
    setAllTenants(tenantRes.items)
    setTenantsLoading(false)
  }

  useEffect(() => { load('all', 1) }, [propertyId])

  async function fetchPricing(unitId: string, moveInDate?: string) {
    setPricingLoading(true)
    try {
      const p = await unitsApi.getPricing(unitId, moveInDate)
      setPricing(p)
      const selectedUnit = vacantUnits.find((u) => u.id === unitId)
      const overrides = selectedUnit?.utility_overrides
      const utilDeposit = overrides
        ? Object.values(overrides).reduce((sum, u) => sum + (u?.deposit ?? 0), 0)
        : 0
      setForm((prev) => ({
        ...prev,
        rent_amount: p.rent_amount,
        deposit_amount: p.deposit_amount,
        utility_deposit: utilDeposit > 0 ? utilDeposit : (p.utility_deposit ?? undefined),
      }))
    } catch {
      // user can fill manually
    } finally {
      setPricingLoading(false)
    }
  }

  async function handleUnitChange(unitId: string) {
    setForm((prev) => ({ ...prev, unit_id: unitId, rent_amount: 0, deposit_amount: 0, utility_deposit: undefined }))
    setPricing(null)
    if (!unitId) return
    await fetchPricing(unitId, form.start_date || undefined)
  }

  function handleStartDateChange(startDate: string) {
    setForm((prev) => ({
      ...prev,
      start_date: startDate,
      end_date: startDate ? addOneYear(startDate) : prev.end_date,
    }))
    // Re-fetch pricing with the new date to recompute pro-rated rent
    if (form.unit_id && startDate) {
      fetchPricing(form.unit_id, startDate)
    }
  }

  function handleTenantSelect(id: string) {
    setTenantId(id)
  }

  async function handleCreate() {
    if (!propertyId) return
    setCreateLoading(true)
    setCreateError(null)
    try {
      let payload: LeaseCreateRequest

      if (tenantMode === 'existing') {
        payload = { ...form, tenant_id: tenantId }
      } else if (tenantMode === 'create') {
        payload = { ...form, tenant_create: tenantCreate }
      } else {
        // invite mode — create tenant with temp password, then send invite
        payload = {
          ...form,
          tenant_create: { ...tenantCreate, password: tempPassword() },
        }
      }

      const createdLease = await leasesApi.create(propertyId, payload)

      // Resolve invite email for success message
      const inviteEmail =
        tenantMode === 'invite' || tenantMode === 'create'
          ? tenantCreate.email
          : allTenants.find((t) => t.id === tenantId)?.email ?? null

      setShowCreate(false)
      resetForm()
      load(activeTab, 1)

      if (createdLease.onboarding_token) {
        setCreatedOnboardingToken(createdLease.onboarding_token)
        setSuccessMsg(
          inviteEmail
            ? `Lease created. Onboarding invite sent to ${inviteEmail}.`
            : 'Lease created. Onboarding record linked.'
        )
      } else {
        setSuccessMsg('Lease created successfully.')
      }
    } catch (err) {
      setCreateError(extractApiError(err).message)
    } finally {
      setCreateLoading(false)
    }
  }

  function resetForm() {
    setForm({ unit_id: '', start_date: '', rent_amount: 0, deposit_amount: 0, utility_deposit: undefined, notes: '' })
    setTenantId('')
    setTenantCreate(EMPTY_INLINE)
    setTenantMode('existing')
    setPricing(null)
    setCreateError(null)
    setTenantSearch('')
  }

  async function handleActivate(leaseId: string) {
    setError(null)
    try {
      const updated = await leasesApi.activate(leaseId)
      setLeases((prev) => prev.map((l) => (l.id === leaseId ? updated : l)))
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  async function handleRowSendInvite() {
    if (!rowInviteEmail || !propertyId) return
    setRowInviteLoading(true)
    setRowInviteError(null)
    try {
      let obId = inviteOnboardingId
      if (!obId) {
        // No onboarding yet — create one linked to this lease
        const ob = await onboardingsApi.create({
          property_id: propertyId,
          lease_id: inviteLeaseId ?? undefined,
        })
        obId = ob.id
        // Update the lease row locally so the link is reflected immediately
        if (inviteLeaseId) {
          setLeases((prev) =>
            prev.map((l) => (l.id === inviteLeaseId ? { ...l, onboarding_id: ob.id } : l))
          )
        }
      }
      await onboardingsApi.sendInvite(obId, rowInviteEmail)
      setSuccessMsg(`Invite sent to ${rowInviteEmail}`)
      setInviteLeaseId(null)
      setInviteOnboardingId(null)
      setRowInviteEmail('')
    } catch (err) {
      setRowInviteError(extractApiError(err).message)
    } finally {
      setRowInviteLoading(false)
    }
  }

  // Client-side search across currently loaded leases
  const q = searchQuery.trim().toLowerCase()
  const displayed = q
    ? leases.filter((l) => {
        const tenant = tenantMap.get(l.tenant_id)
        const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}`.toLowerCase() : ''
        return (
          tenantName.includes(q) ||
          (l.unit_code ?? '').toLowerCase().includes(q) ||
          (l.reference_no ?? '').toLowerCase().includes(q)
        )
      })
    : leases

  // Metrics from loaded rows
  const activeLeases  = leases.filter((l) => l.status === 'active')
  const arrearsLeases = activeLeases.filter((l) => { const s = paymentMap.get(l.id); return s && (s.outstanding_balance ?? 0) > 0 })
  const paidLeases    = activeLeases.filter((l) => { const s = paymentMap.get(l.id); return s && (s.outstanding_balance ?? 0) === 0 })
  const expiringLeases = activeLeases.filter((l) => { const d = daysUntil(l.end_date); return d !== null && d >= 0 && d <= 60 })
  const totalMonthlyRent = activeLeases.reduce((s, l) => s + (l.effective_rent ?? l.rent_amount), 0)
  const totalArrears = activeLeases.reduce((s, l) => { const pm = paymentMap.get(l.id); return s + (pm?.outstanding_balance ?? 0) }, 0)

  const counts = {
    all:               leases.length,
    active:            leases.filter((l) => l.status === 'active').length,
    draft:             leases.filter((l) => l.status === 'draft').length,
    pending_payment:   leases.filter((l) => l.status === 'pending_payment').length,
    pending_signature: leases.filter((l) => l.status === 'pending_signature').length,
    expired:           leases.filter((l) => l.status === 'expired').length,
    terminated:        leases.filter((l) => l.status === 'terminated').length,
  }

  const filteredTenants = tenantSearch
    ? allTenants.filter((t) =>
        `${t.first_name} ${t.last_name} ${t.email}`.toLowerCase().includes(tenantSearch.toLowerCase())
      )
    : allTenants

  const tenantValid =
    tenantMode === 'existing'
      ? !!tenantId
      : tenantMode === 'invite'
      ? !!(tenantCreate.email && tenantCreate.first_name && tenantCreate.last_name)
      : !!(tenantCreate.email && tenantCreate.first_name && tenantCreate.last_name && tenantCreate.password)

  const canCreate = !!form.unit_id && !!form.start_date && tenantValid

  return (
    <>
    <div className="p-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link to="/portfolio" className="hover:text-blue-600 transition-colors">Portfolio</Link>
          <span>›</span>
          <Link to="/portfolio/properties" className="hover:text-blue-600 transition-colors">Real Estate</Link>
          <span>›</span>
          {propertyName ? <span className="text-gray-700">{propertyName}</span> : <span className="text-gray-400">…</span>}
          <span>›</span>
          <span className="text-gray-900 font-medium">Leases</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Leases</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${displayed.length} of ${total} lease${total !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => isUnlocked ? undefined : setShowMfa(true)}
              title={isUnlocked ? 'PII visible — session active' : 'Unlock to view PII'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isUnlocked
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{isUnlocked ? '🔓' : '🔒'}</span>
              {isUnlocked ? 'PII Unlocked' : 'View PII'}
            </button>
            <Link
              to={`/portfolio/properties/${propertyId}/units`}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-medium transition-colors"
            >
              ← Manage Units
            </Link>
            <button
              onClick={() => { setShowCreate(true); loadFormData() }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              + New Lease
            </button>
          </div>
        </div>

        {/* Metric cards */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
            <MetricCard label="Active"       value={String(counts.active)}       accent="blue"    sub={`of ${total} total`} />
            <MetricCard label="Monthly Rent" value={`KES ${fmt(totalMonthlyRent)}`} accent="green" />
            <MetricCard label="In Arrears"   value={String(arrearsLeases.length)} accent="red"    sub={totalArrears > 0 ? `KES ${fmt(totalArrears)}` : undefined} />
            <MetricCard label="Paid Up"      value={String(paidLeases.length)}   accent="emerald" />
            <MetricCard label="Expiring ≤60d" value={String(expiringLeases.length)} accent={expiringLeases.length > 0 ? 'orange' : 'gray'} />
            <MetricCard label="Draft"        value={String(counts.draft)}        accent="gray" />
            <MetricCard label="Terminated"   value={String(counts.terminated)}   accent="gray" />
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center justify-between">
            <span>{successMsg}</span>
            <div className="flex items-center gap-3 ml-4 shrink-0">
              {createdOnboardingToken && (
                <button
                  onClick={() => navigate(`/onboarding/${createdOnboardingToken}`)}
                  className="text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                >
                  Go to Onboarding →
                </button>
              )}
              <button onClick={() => { setSuccessMsg(null); setCreatedOnboardingToken(null) }} className="text-green-600 hover:text-green-800">✕</button>
            </div>
          </div>
        )}

        {/* Filters row */}
        {!loading && (
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {/* Status tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                    activeTab === tab.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  {tab.label}
                  <span className="ml-1.5 text-[10px] text-gray-400">{counts[tab.key] ?? 0}</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[180px] max-w-xs relative">
              <span className="absolute inset-y-0 left-2.5 flex items-center text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search tenant, unit or ref…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-2.5 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 h-20 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && displayed.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <span className="text-4xl block mb-3">📋</span>
            <p className="text-sm font-medium text-gray-700 mb-1">No leases found</p>
            <p className="text-xs text-gray-400 mt-1">
              {searchQuery
                ? 'No leases match your search.'
                : activeTab === 'all'
                ? 'No leases have been created for this property yet.'
                : `No ${TABS.find(t => t.key === activeTab)?.label.toLowerCase()} leases.`}
            </p>
            {activeTab !== 'all' && !searchQuery && (
              <button onClick={() => handleTabChange('all')} className="mt-3 text-xs text-blue-600 underline">Show all</button>
            )}
            {activeTab === 'all' && !searchQuery && (
              <button
                onClick={() => { setShowCreate(true); loadFormData() }}
                className="mt-3 text-sm text-blue-600 font-medium hover:underline"
              >
                Create the first lease →
              </button>
            )}
          </div>
        )}

        {/* Lease rows */}
        {!loading && displayed.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_1.4fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <span>Tenant</span>
              <span>Unit</span>
              <span>Lease / Expiry</span>
              <span>Deposit</span>
              <span>Arrears / Credit</span>
              <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {displayed.map((lease) => {
                const tenant = tenantMap.get(lease.tenant_id)
                const summary = paymentMap.get(lease.id) ?? null
                const days = daysUntil(lease.end_date)
                const expiry = expiryLabel(days)
                const arrears = summary?.outstanding_balance ?? 0
                const credit = summary?.prepayment_credit ?? 0
                const depositPct = summary
                  ? Math.min(100, summary.deposit_required > 0 ? (summary.deposit_paid / summary.deposit_required) * 100 : 100)
                  : 0
                const ob = onboardingByLease.get(lease.id)

                return (
                  <div
                    key={lease.id}
                    onClick={() => setSelectedLease(lease)}
                    className="grid grid-cols-[2fr_1fr_1.4fr_1fr_1fr_auto] gap-4 items-center px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    {/* Tenant */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-blue-700">
                          {tenant ? tenant.first_name.charAt(0).toUpperCase() : '?'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {tenant ? `${tenant.first_name} ${tenant.last_name}` : <span className="text-gray-400 italic">Unknown</span>}
                        </p>
                        <p className={`text-xs truncate ${isUnlocked ? 'text-gray-500' : 'text-gray-400'}`}>
                          {tenant ? (isUnlocked ? tenant.email : maskEmail(tenant.email)) : '—'}
                        </p>
                        {tenant?.phone && (
                          <p className="text-[10px] text-gray-400">
                            {isUnlocked ? tenant.phone : maskPhone(tenant.phone)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Unit */}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {lease.unit_code ?? <span className="text-gray-400">—</span>}
                      </p>
                      <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[lease.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[lease.status] ?? lease.status}
                      </span>
                    </div>

                    {/* Lease / Expiry */}
                    <div>
                      <p className="text-xs text-gray-500">
                        {new Date(lease.start_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {lease.end_date && <> → {new Date(lease.end_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                      </p>
                      <p className={`text-xs mt-0.5 ${expiry.cls}`}>{expiry.text}</p>
                      {lease.discount_amount > 0 ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-gray-400 line-through">KES {fmt(lease.rent_amount)}/mo</span>
                          <span className="text-[10px] text-green-700 font-semibold">KES {fmt(lease.effective_rent)}/mo</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-400 mt-0.5">Rent: KES {fmt(lease.rent_amount)}/mo</p>
                      )}
                    </div>

                    {/* Deposit */}
                    <div>
                      {summary ? (
                        <>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-500">Deposit</span>
                            <span className="font-medium text-gray-900">{fmt(summary.deposit_paid)} / {fmt(summary.deposit_required)}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${depositPct >= 100 ? 'bg-green-500' : 'bg-orange-400'}`}
                              style={{ width: `${depositPct}%` }}
                            />
                          </div>
                          <p className={`text-[10px] mt-0.5 ${depositPct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
                            {depositPct >= 100 ? 'Fully paid' : `${fmt(summary.deposit_required - summary.deposit_paid)} outstanding`}
                          </p>
                        </>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </div>

                    {/* Arrears / Credit */}
                    <div>
                      {summary ? (
                        arrears > 0 ? (
                          <>
                            <p className="text-xs font-semibold text-red-600">KES {fmt(arrears)} overdue</p>
                            <p className="text-[10px] text-red-400">Rent arrears</p>
                          </>
                        ) : credit > 0 ? (
                          <>
                            <p className="text-xs font-semibold text-emerald-600">KES {fmt(credit)} credit</p>
                            <p className="text-[10px] text-emerald-500">Prepayment balance</p>
                          </>
                        ) : (
                          <p className="text-xs text-gray-400">Clear</p>
                        )
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setSelectedLease(lease)}
                        className="px-2.5 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
                      >
                        View
                      </button>
                      <div className="relative" ref={openMenuId === lease.id ? menuRef : undefined}>
                        <button
                          onClick={(e) => {
                            if (openMenuId === lease.id) { setOpenMenuId(null); setMenuPos(null) }
                            else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                              setOpenMenuId(lease.id)
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>
                        {openMenuId === lease.id && menuPos && createPortal(
                          <div
                            ref={menuRef}
                            style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
                            className="bg-white rounded-xl shadow-xl border border-gray-100 py-1 w-44"
                          >
                            {lease.status === 'draft' && (() => {
                              const canActivate = !ob || ['kyc_submitted', 'signed', 'activated'].includes(ob.status)
                              return (
                                <button
                                  onClick={() => { canActivate && handleActivate(lease.id); setOpenMenuId(null) }}
                                  disabled={!canActivate}
                                  title={!canActivate && ob ? `Onboarding not complete (${ob.status})` : undefined}
                                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 ${canActivate ? 'text-gray-700' : 'text-gray-400'}`}
                                >
                                  Activate
                                </button>
                              )
                            })()}
                            {['draft', 'pending_payment', 'pending_signature'].includes(lease.status) && (
                              <button
                                onClick={() => {
                                  setInviteLeaseId(lease.id)
                                  setInviteOnboardingId(ob?.id ?? lease.onboarding_id ?? null)
                                  setRowInviteEmail(ob?.invite_email ?? tenant?.email ?? '')
                                  setRowInviteError(null)
                                  setOpenMenuId(null)
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                {(ob ?? lease.onboarding_id) ? 'Resend Invite' : 'Send Invite'}
                              </button>
                            )}
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Load more */}
        {!loading && !searchQuery && leases.length < total && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-5 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? 'Loading…' : `Load more (${total - leases.length} remaining)`}
            </button>
          </div>
        )}
      </div>

      {/* ── Create Lease modal ────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8">

            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-lg text-gray-900">New Lease</h3>
              <p className="text-sm text-gray-400 mt-0.5">Unit → Tenant → Dates → Financials</p>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* ── 1. Unit ── */}
              <div>
                <SectionLabel>1. Unit</SectionLabel>
                <select
                  className="input"
                  value={form.unit_id}
                  onChange={(e) => handleUnitChange(e.target.value)}
                >
                  <option value="">Select a vacant unit…</option>
                  {vacantUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unit_code} — {u.status}
                      {u.rent_base != null ? ` · KES ${u.rent_base.toLocaleString()}` : ''}
                    </option>
                  ))}
                </select>

                {/* Pricing breakdown (inline, compact) */}
                {pricingLoading && (
                  <p className="text-xs text-gray-400 mt-2">Loading pricing…</p>
                )}
                {pricing && !pricingLoading && (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
                    <div className="flex justify-between px-3 py-2 text-gray-700">
                      <span>
                        Pro-rated rent
                        <span className="text-gray-400 text-xs ml-1">
                          ({pricing.prorated_days}/{pricing.days_in_month} days · KES {pricing.rent_amount.toLocaleString()}/mo)
                        </span>
                      </span>
                      <span className="font-medium">KES {pricing.prorated_rent.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between px-3 py-2 text-gray-700">
                      <span>Security deposit <span className="text-gray-400 text-xs">({pricing.deposit_rule.replace(/_/g, ' ')})</span></span>
                      <span>KES {pricing.deposit_amount.toLocaleString()}</span>
                    </div>
                    {pricing.utility_deposit != null && (
                      <div className="flex justify-between px-3 py-2 text-gray-700">
                        <span>Utility deposit</span>
                        <span>KES {pricing.utility_deposit.toLocaleString()}</span>
                      </div>
                    )}
                    {pricing.utilities.length > 0 && (
                      <div className="px-3 py-2">
                        <p className="text-xs text-gray-400 font-medium mb-1.5">Utility charges</p>
                        <div className="space-y-1">
                          {pricing.utilities.map((u) => (
                            <div key={u.key} className="text-xs">
                              <div className="flex justify-between text-gray-600">
                                <span>{u.label}</span>
                                <span className="text-gray-400 capitalize">
                                  {u.type}{u.rate != null ? ` · KES ${u.rate}${u.unit_label ? '/' + u.unit_label : ''}` : ''}
                                </span>
                              </div>
                              {u.deposit != null && (
                                <div className="flex justify-between text-gray-400 pl-3">
                                  <span>↳ deposit</span>
                                  <span>KES {u.deposit.toLocaleString()}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between px-3 py-2 font-semibold text-gray-900 bg-gray-100 rounded-b-lg">
                      <span>Total move-in</span>
                      <span>KES {pricing.total_move_in.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 2. Tenant ── */}
              <div>
                <SectionLabel>2. Tenant</SectionLabel>

                {/* Mode picker — treated as equal options */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {(
                    [
                      { mode: 'existing', title: 'Existing tenant', sub: 'Select from your tenant list' },
                      { mode: 'invite',   title: 'Invite new tenant', sub: 'Creates account + sends onboarding link' },
                      { mode: 'create',   title: 'Create without invite', sub: 'Set their password manually' },
                    ] as { mode: TenantMode; title: string; sub: string }[]
                  ).map(({ mode, title, sub }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTenantMode(mode)}
                      className={[
                        'text-left px-3 py-3 rounded-lg border text-sm transition-colors',
                        tenantMode === mode
                          ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      <p className="font-medium">{title}</p>
                      <p className="text-xs mt-0.5 opacity-70">{sub}</p>
                    </button>
                  ))}
                </div>

                {/* Existing tenant */}
                {tenantMode === 'existing' && (
                  <div className="space-y-2">
                    <input
                      className="input"
                      placeholder="Search by name or email…"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    {tenantsLoading ? (
                      <p className="text-xs text-gray-400">Loading tenants…</p>
                    ) : filteredTenants.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2">
                        No tenants found.{' '}
                        <button className="text-blue-600 underline" onClick={() => setTenantMode('invite')}>
                          Invite a new tenant instead?
                        </button>
                      </p>
                    ) : (
                      <select
                        className="input"
                        value={tenantId}
                        onChange={(e) => handleTenantSelect(e.target.value)}
                        size={Math.min(filteredTenants.length + 1, 5)}
                      >
                        <option value="">— Select tenant —</option>
                        {filteredTenants.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.first_name} {t.last_name} · {isUnlocked ? t.email : maskEmail(t.email)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Invite new tenant */}
                {tenantMode === 'invite' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                      <span>📧</span>
                      <span>
                        We'll create their account and email them a link to upload ID docs and complete their profile.
                        No password required from you.
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">First name *</label>
                        <input className="input" value={tenantCreate.first_name}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, first_name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Last name *</label>
                        <input className="input" value={tenantCreate.last_name}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, last_name: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Email *</label>
                        <input className="input" type="email" value={tenantCreate.email}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, email: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Phone</label>
                        <input className="input" value={tenantCreate.phone ?? ''}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, phone: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Create without invite */}
                {tenantMode === 'create' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">First name *</label>
                        <input className="input" value={tenantCreate.first_name}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, first_name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Last name *</label>
                        <input className="input" value={tenantCreate.last_name}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, last_name: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Email *</label>
                        <input className="input" type="email" value={tenantCreate.email}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, email: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Phone</label>
                        <input className="input" value={tenantCreate.phone ?? ''}
                          onChange={(e) => setTenantCreate((p) => ({ ...p, phone: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="label">Password *</label>
                      <input className="input" type="password" value={tenantCreate.password}
                        onChange={(e) => setTenantCreate((p) => ({ ...p, password: e.target.value }))}
                        placeholder="Min 8 characters" />
                    </div>
                  </div>
                )}
              </div>

              {/* ── 3. Lease dates ── */}
              <div>
                <SectionLabel>3. Lease period</SectionLabel>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Start date *</label>
                    <input
                      type="date"
                      className="input"
                      value={form.start_date}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">
                      End date{' '}
                      <span className="text-gray-400 font-normal text-xs">(auto +1 year)</span>
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={form.end_date ?? ''}
                      onChange={(e) => setForm({ ...form, end_date: e.target.value || undefined })}
                    />
                  </div>
                </div>
              </div>

              {/* ── 4. Financials ── */}
              <div>
                <SectionLabel>4. Financials</SectionLabel>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="label">Monthly rent (KES) *</label>
                    <input type="number" className="input" value={form.rent_amount || ''}
                      onChange={(e) => setForm({ ...form, rent_amount: +e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Security deposit (KES) *</label>
                    <input type="number" className="input" value={form.deposit_amount || ''}
                      onChange={(e) => setForm({ ...form, deposit_amount: +e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="label">
                    Utility deposit (KES)
                    <span className="text-gray-400 font-normal text-xs ml-1">— auto-summed from utility configs</span>
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={form.utility_deposit ?? ''}
                    onChange={(e) => setForm({ ...form, utility_deposit: e.target.value ? +e.target.value : undefined })}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* ── 5. Notes ── */}
              <div>
                <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes ?? ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value || undefined })}
                  placeholder="Any additional terms or notes…"
                />
              </div>

              {createError && (
                <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {createError}
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {tenantMode === 'invite' && tenantCreate.email
                  ? `Invite will be sent to ${isUnlocked ? tenantCreate.email : maskEmail(tenantCreate.email)}`
                  : tenantMode === 'existing' && tenantId
                  ? `${allTenants.find((t) => t.id === tenantId)?.first_name ?? ''} ${allTenants.find((t) => t.id === tenantId)?.last_name ?? ''} selected`
                  : 'Fill in the required fields above'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowCreate(false); resetForm() }}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={createLoading || !canCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
                >
                  {createLoading
                    ? (tenantMode === 'invite' ? 'Creating & sending invite…' : 'Creating…')
                    : tenantMode === 'invite'
                    ? 'Create lease & send invite'
                    : 'Create lease'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Row invite modal ─────────────────────────────────────────────── */}
      {inviteLeaseId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-[400px] space-y-4">
            <div>
              <h3 className="font-semibold text-lg">
                {inviteOnboardingId ? 'Resend Onboarding Invite' : 'Send Onboarding Invite'}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {inviteOnboardingId
                  ? 'Send the tenant a new link to their onboarding wizard.'
                  : 'Create an onboarding record and send the tenant an invite link.'}
              </p>
            </div>
            <div>
              <label className="label">Email address *</label>
              <input
                className="input"
                type="email"
                value={rowInviteEmail}
                onChange={(e) => setRowInviteEmail(e.target.value)}
                placeholder="tenant@example.com"
                autoFocus
              />
            </div>
            {rowInviteError && <p className="text-red-600 text-sm">{rowInviteError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setInviteLeaseId(null)
                  setInviteOnboardingId(null)
                  setRowInviteEmail('')
                  setRowInviteError(null)
                }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRowSendInvite}
                disabled={rowInviteLoading || !rowInviteEmail}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {rowInviteLoading ? 'Sending…' : inviteOnboardingId ? 'Resend Invite' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
      <LeaseDetailSlideOver
        lease={selectedLease}
        onboardingId={selectedLease ? (onboardingByLease.get(selectedLease.id)?.id ?? null) : null}
        onClose={() => { setSelectedLease(null); load() }}
      />

      {showMfa && (
        <MfaPinModal
          onUnlocked={(token, expiresIn) => { unlock(token, expiresIn); setShowMfa(false) }}
          onClose={() => setShowMfa(false)}
        />
      )}
    </>
  )
}

function MetricCard({
  label, value, sub, accent,
}: {
  label: string
  value: string
  sub?: string
  accent: 'blue' | 'green' | 'red' | 'emerald' | 'orange' | 'gray'
}) {
  const colors: Record<string, string> = {
    blue:    'bg-blue-50   border-blue-200   text-blue-700',
    green:   'bg-green-50  border-green-200  text-green-700',
    red:     'bg-red-50    border-red-200    text-red-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    gray:    'bg-gray-50   border-gray-200   text-gray-600',
  }
  return (
    <div className={`rounded-xl border p-3 ${colors[accent]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70 mb-1">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}
