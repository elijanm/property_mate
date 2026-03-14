import { Link, useParams } from 'react-router-dom'
import { useProperty } from '@/context/PropertyContext'
import { routes } from '@/utils/routes'

interface Props {
  page: string
}

export default function PropertyBreadcrumb({ page }: Props) {
  const { propertyId } = useParams<{ propertyId: string }>()
  const property = useProperty()

  return (
    <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
      <Link to={routes.portfolio} className="hover:text-gray-600 transition-colors">Portfolio</Link>
      <span>›</span>
      <Link to={routes.properties} className="hover:text-gray-600 transition-colors">Real Estate</Link>
      <span>›</span>
      <Link to={routes.property(propertyId!)} className="hover:text-gray-600 transition-colors">{property?.name ?? '…'}</Link>
      <span>›</span>
      <span className="text-gray-700 font-medium">{page}</span>
    </nav>
  )
}
