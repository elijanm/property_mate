import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'

export default function PropertyServiceProvidersPage() {
  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Service Providers" />
      <h1 className="text-xl font-bold text-gray-900 mb-2">Service Providers</h1>
      <p className="text-sm text-gray-500 mb-8">Vendors and contractors assigned to this property.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <span className="text-4xl block mb-3">🛠</span>
        <p className="text-sm font-medium text-gray-700 mb-1">Service providers coming soon</p>
        <p className="text-xs text-gray-400">Manage plumbers, electricians, cleaners, and other vendors.</p>
      </div>
    </div>
  )
}
