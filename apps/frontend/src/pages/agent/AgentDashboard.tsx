import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import DashboardLayout from '@/layouts/DashboardLayout'
import type { Property } from '@/types/property'

export default function AgentDashboard() {
  const { user } = useAuth()
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

  const totalUnits = properties.reduce((s, p) => s + p.unit_count, 0)
  const displayName = user?.email?.split('@')[0] ?? 'there'

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {displayName}</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your assigned properties and tenants.</p>
        </div>

        <div className="grid grid-cols-2 gap-5 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 font-medium">Properties</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? '—' : properties.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 font-medium">Total Units</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {loading ? '—' : totalUnits.toLocaleString()}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Assigned Properties</h2>
            {properties.length > 0 && (
              <Link to="/portfolio/properties" className="text-sm text-blue-600 hover:underline">
                View all →
              </Link>
            )}
          </div>

          {loading && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading…</div>
          )}

          {!loading && properties.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              No properties assigned yet.
            </div>
          )}

          {!loading && properties.length > 0 && (
            <div className="divide-y divide-gray-50">
              {properties.map((p) => (
                <div
                  key={p.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {p.address.city} · {p.unit_count} units · {p.property_type}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to={`/portfolio/properties/${p.id}/units`}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-medium"
                    >
                      Units
                    </Link>
                    <Link
                      to={`/portfolio/properties/${p.id}/leases`}
                      className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium"
                    >
                      Leases
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
