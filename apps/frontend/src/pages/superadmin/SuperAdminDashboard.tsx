import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import type { Property } from '@/types/property'

const TYPE_STYLE: Record<string, string> = {
  residential: 'bg-blue-50 text-blue-700',
  commercial: 'bg-emerald-50 text-emerald-700',
  mixed: 'bg-purple-50 text-purple-700',
}

export default function SuperAdminDashboard() {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    propertiesApi
      .list({ page_size: 100 })
      .then((r) => setProperties(r.items))
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [])

  const totalUnits = properties.reduce((s, p) => s + p.unit_count, 0)
  const orgCount = new Set(properties.map((p) => p.org_id)).size

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Super admin — full platform access.</p>
        </div>

        <div className="grid grid-cols-3 gap-5 mb-8">
          {[
            { label: 'Total Properties', value: loading ? '—' : properties.length },
            { label: 'Total Units', value: loading ? '—' : totalUnits.toLocaleString() },
            { label: 'Organisations', value: loading ? '—' : orgCount },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-sm text-gray-500 font-medium">{s.label}</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">All Properties</h2>
            <Link to="/portfolio/properties" className="text-sm text-blue-600 hover:underline">
              Manage →
            </Link>
          </div>

          {loading && (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading…</div>
          )}

          {!loading && properties.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              No properties on platform yet.
            </div>
          )}

          {!loading && properties.length > 0 && (
            <div className="divide-y divide-gray-50">
              {properties.slice(0, 10).map((p) => (
                <div
                  key={p.id}
                  className="px-6 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{p.org_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_STYLE[p.property_type] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {p.property_type}
                    </span>
                    <span className="text-xs text-gray-400">{p.unit_count} units</span>
                    <Link
                      to={`/portfolio/properties/${p.id}/units`}
                      className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium"
                    >
                      View
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
