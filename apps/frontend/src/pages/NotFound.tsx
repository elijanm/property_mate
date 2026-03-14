import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <p className="text-gray-600 mt-2">Page not found</p>
        <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
          Go home
        </Link>
      </div>
    </div>
  )
}
