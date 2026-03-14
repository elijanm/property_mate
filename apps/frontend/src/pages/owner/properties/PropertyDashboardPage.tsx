import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { unitsApi } from '@/api/units'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { leasesApi } from '@/api/leases'
import { useProperty } from '@/context/PropertyContext'
import CCTVDashboardWidget from '@/components/cctv/CCTVDashboardWidget'
import type { Unit } from '@/types/unit'
import type { Lease } from '@/types/lease'

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function QuickLink({ to, icon, label, desc }: { to: string; icon: string; label: string; desc: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <span className="text-2xl w-10 text-center">{icon}</span>
      <div>
        <p className="font-semibold text-gray-900 text-sm">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
    </Link>
  )
}

export default function PropertyDashboardPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const property = useProperty()
  const hasCCTV = property?.installed_apps?.includes('cctv') ?? false
  const [units, setUnits] = useState<Unit[]>([])
  const [leases, setLeases] = useState<Lease[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    Promise.allSettled([
      unitsApi.list(propertyId, { page_size: 200 }),
      leasesApi.list(propertyId),
    ]).then(([unitsRes, leasesRes]) => {
      if (unitsRes.status === 'fulfilled') setUnits(unitsRes.value.items)
      if (leasesRes.status === 'fulfilled') setLeases(leasesRes.value.items)
    }).finally(() => setLoading(false))
  }, [propertyId])

  const vacant = units.filter((u) => u.status === 'vacant').length
  const occupied = units.filter((u) => u.status === 'occupied').length
  const reserved = units.filter((u) => u.status === 'reserved').length
  const activeLeases = leases.filter((l) => l.status === 'active').length
  const draftLeases = leases.filter((l) => l.status === 'draft').length
  const expiredLeases = leases.filter((l) => l.status === 'expired').length

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 bg-gray-200 rounded w-48 mb-6 animate-pulse" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Dashboard" />
      <h1 className="text-xl font-bold text-gray-900 mb-6">Overview</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Units" value={units.length} />
        <StatCard label="Occupied" value={occupied} sub={reserved > 0 ? `${reserved} reserved` : undefined} />
        <StatCard label="Vacant" value={vacant} />
        <StatCard label="Active Leases" value={activeLeases} sub={draftLeases > 0 ? `${draftLeases} draft` : undefined} />
      </div>

      {/* Lease alerts */}
      {expiredLeases > 0 && (
        <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
          {expiredLeases} lease{expiredLeases !== 1 ? 's' : ''} expired — review in{' '}
          <Link to={`/portfolio/properties/${propertyId}/leases`} className="underline font-medium">Leases</Link>.
        </div>
      )}

      {/* Quick links + CCTV side by side when CCTV is installed */}
      <div className={hasCCTV ? 'grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch' : ''}>
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Access</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <QuickLink
              to={`/portfolio/properties/${propertyId}/units`}
              icon="🏠"
              label="Units"
              desc={`${units.length} total · ${vacant} vacant`}
            />
            <QuickLink
              to={`/portfolio/properties/${propertyId}/leases`}
              icon="📋"
              label="Leases"
              desc={`${activeLeases} active · ${draftLeases} draft`}
            />
            <QuickLink
              to={`/portfolio/properties/${propertyId}/tenants`}
              icon="👥"
              label="Tenants"
              desc="View all tenants in this property"
            />
            <QuickLink
              to={`/portfolio/properties/${propertyId}/tickets`}
              icon="🔧"
              label="Tickets"
              desc="Maintenance & support requests"
            />
          </div>
          {/* Promo banner — fills remaining height to match CCTV column */}
          {hasCCTV && (
            <Link
              to={`/portfolio/properties/${propertyId}/apps`}
              className="flex-1 mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 transition-colors cursor-pointer min-h-[80px] px-6 py-5 text-center"
            >
              <span className="text-2xl mb-2">🧩</span>
              <p className="text-sm font-semibold text-indigo-700">Explore Apps</p>
              <p className="text-xs text-indigo-400 mt-0.5">Voice agent, smart meters, vendor tools & more</p>
            </Link>
          )}
        </div>

        {hasCCTV && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">CCTV</h2>
              <Link to={`/portfolio/properties/${propertyId}/cctv`} className="text-xs text-blue-600 hover:underline">Manage →</Link>
            </div>
            <div className="flex-1">
              <CCTVDashboardWidget />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
