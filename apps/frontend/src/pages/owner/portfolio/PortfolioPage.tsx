import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'

interface Category {
  id: string
  label: string
  icon: string
  description: string
  status: 'active' | 'coming_soon'
  path?: string
  stats?: string
}

const CATEGORIES: Category[] = [
  {
    id: 'real_estate',
    label: 'Real Estate',
    icon: '🏢',
    description: 'Residential and commercial properties — units, leases, tenants, accounting, maintenance, and more.',
    status: 'active',
    path: '/portfolio/properties',
    stats: 'Manage properties',
  },
  {
    id: 'farming',
    label: 'Farming',
    icon: '🌾',
    description: '',
    status: 'coming_soon',
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing',
    icon: '🏭',
    description: '',
    status: 'coming_soon',
  },
  {
    id: 'retail',
    label: 'Retail & Warehousing',
    icon: '🏪',
    description: '',
    status: 'coming_soon',
  },
]

export default function PortfolioPage() {
  const navigate = useNavigate()

  return (
    <DashboardLayout>
      <div className="p-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Portfolio</h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose an asset class to manage. Each category has its own workspace, ledger, and processes.
          </p>
        </div>

        {/* Category grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {CATEGORIES.map((cat) =>
            cat.status === 'active' ? (
              /* Active category — full card */
              <div
                key={cat.id}
                onClick={() => cat.path && navigate(cat.path)}
                className="relative rounded-2xl border border-gray-200 bg-white p-6 hover:border-blue-300 hover:shadow-md cursor-pointer group transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-3xl mb-4 transition-colors">
                  {cat.icon}
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">{cat.label}</h2>
                <p className="text-sm text-gray-500 leading-relaxed">{cat.description}</p>
                <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open {cat.label}
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </div>
            ) : (
              /* Coming soon — dotted placeholder */
              <div
                key={cat.id}
                className="rounded-2xl border-2 border-dashed border-gray-200 p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[160px] cursor-default hover:border-gray-300 hover:bg-gray-50 transition-all group"
              >
                <span className="text-3xl opacity-30 group-hover:opacity-50 transition-opacity">{cat.icon}</span>
                <span className="text-[10px] font-semibold uppercase tracking-widest bg-gray-100 text-gray-400 px-2.5 py-0.5 rounded-full">
                  Coming Soon
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
