import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

const roleHome: Record<string, string> = {
  owner: '/owner',
  agent: '/agent',
  tenant: '/tenant',
  service_provider: '/service-provider',
  superadmin: '/superadmin',
}

export default function Forbidden() {
  const { user } = useAuth()
  const home = user ? (roleHome[user.role] ?? '/') : '/login'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">403</h1>
        <p className="text-gray-700 mt-2 text-lg font-medium">Access denied</p>
        <p className="text-gray-500 text-sm mt-1">
          You don&apos;t have permission to view this page.
        </p>
        <Link to={home} className="mt-4 inline-block text-blue-600 hover:underline text-sm">
          Go to your dashboard
        </Link>
      </div>
    </div>
  )
}
