import { useCallback, useEffect, useState } from 'react'
import { useParams, Outlet, Navigate } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import PropertyWorkspaceLayout from '@/layouts/PropertyWorkspaceLayout'
import { PropertyProvider } from '@/context/PropertyContext'
import type { Property } from '@/types/property'

export default function PropertyWorkspacePage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!propertyId) return
    propertiesApi.get(propertyId)
      .then(setProperty)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [propertyId])

  const refreshProperty = useCallback(async () => {
    if (!propertyId) return
    const updated = await propertiesApi.get(propertyId)
    setProperty(updated)
  }, [propertyId])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    )
  }

  if (notFound || !property) return <Navigate to="/portfolio/properties" replace />

  return (
    <PropertyProvider value={{ property, refreshProperty }}>
      <PropertyWorkspaceLayout property={property}>
        <Outlet />
      </PropertyWorkspaceLayout>
    </PropertyProvider>
  )
}
