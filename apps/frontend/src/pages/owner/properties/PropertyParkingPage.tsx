import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'

export default function PropertyParkingPage() {
  const { propertyId } = useParams<{ propertyId: string }>()

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Parking" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Parking</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage parking bays, assignments, and fees.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <span className="text-4xl block mb-3">🅿</span>
        <p className="text-sm font-medium text-gray-700 mb-1">Parking management coming soon</p>
        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          Assign parking bays to units or tenants, track availability, and collect parking fees.
        </p>
        <p className="text-xs text-gray-400 mt-4">
          Parking fee is configured in{' '}
          <Link to={`/portfolio/properties/${propertyId}/settings`} className="text-blue-600 underline">
            Property Settings
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
