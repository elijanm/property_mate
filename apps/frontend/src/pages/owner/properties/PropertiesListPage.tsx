import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import DashboardLayout from '@/layouts/DashboardLayout'
import type { Property } from '@/types/property'
import { getPropertyColor } from '@/layouts/PropertyWorkspaceLayout'

const TYPE_LABEL: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  mixed: 'Mixed Use',
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="h-2 bg-gray-200" />
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gray-200 shrink-0" />
          <div>
            <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-6 bg-gray-100 rounded-lg w-16" />
          <div className="h-6 bg-gray-100 rounded-lg w-16" />
        </div>
      </div>
    </div>
  )
}

export default function PropertiesListPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    propertiesApi
      .list({ page_size: 50 })
      .then((r) => setProperties(r.items))
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [])

  const canCreate = user?.role === 'owner' || user?.role === 'superadmin'

  return (
    <DashboardLayout backLink={{ label: 'Portfolio', to: '/portfolio' }}>
      <div className="p-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-5">
          <Link to="/portfolio" className="hover:text-gray-600 transition-colors">Portfolio</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">Real Estate</span>
        </nav>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
            {!loading && (
              <p className="text-sm text-gray-500 mt-1">
                {properties.length} {properties.length === 1 ? 'property' : 'properties'}
              </p>
            )}
          </div>
          {canCreate && (
            <Link
              to="/portfolio/properties/new"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Property
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {!loading && !error && properties.length === 0 && (
          <div className="text-center py-24">
            <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🏢</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No properties yet</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
              {canCreate
                ? 'Create your first property to start managing units and leases.'
                : 'No properties have been assigned to you yet.'}
            </p>
            {canCreate && (
              <Link
                to="/portfolio/properties/new"
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 inline-block"
              >
                Create Property
              </Link>
            )}
          </div>
        )}

        {!loading && properties.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {properties.map((p, idx) => {
              const color = getPropertyColor(p, idx)
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/portfolio/properties/${p.id}`)}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden text-left hover:shadow-md hover:border-gray-300 transition-all group"
                >
                  {/* Color accent bar */}
                  <div className="h-1.5" style={{ backgroundColor: color }} />

                  <div className="p-5">
                    {/* Avatar + name */}
                    <div className="flex items-start gap-3 mb-4">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        <span className="text-white text-sm font-bold">
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate group-hover:text-gray-700">
                          {p.name}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {p.address.city}, {p.region}
                        </p>
                      </div>
                      {p.status !== 'active' && (
                        <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full text-[10px] font-medium capitalize shrink-0">
                          {p.status}
                        </span>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-lg text-xs">
                        <span className="font-bold text-gray-900">{p.unit_count}</span>
                        <span className="text-gray-500">units</span>
                      </span>
                      {p.wings.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-lg text-xs">
                          <span className="font-bold text-gray-900">{p.wings.length}</span>
                          <span className="text-gray-500">wings</span>
                        </span>
                      )}
                      <span
                        className="px-2.5 py-1 rounded-lg text-xs font-medium"
                        style={{ backgroundColor: `${color}18`, color }}
                      >
                        {TYPE_LABEL[p.property_type] ?? p.property_type}
                      </span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 pb-4">
                    <p className="text-xs text-gray-400 group-hover:text-gray-500 transition-colors">
                      Click to open workspace →
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
