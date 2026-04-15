import { useNavigate } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'

const CATEGORIES = [
  { id: 'real_estate',       label: 'Real Estate',                 icon: '🏢', path: '/portfolio/properties', status: 'active' },
  { id: 'framework_assets',  label: 'Framework Asset Management',  icon: '⚡', path: '/portfolio/frameworks',  status: 'active' },
  { id: 'farming',           label: 'Farming',                     icon: '🌾', status: 'coming_soon' },
  { id: 'manufacturing',     label: 'Manufacturing',               icon: '🏭', status: 'coming_soon' },
  { id: 'retail',            label: 'Retail & Warehousing',        icon: '🏪', status: 'coming_soon' },
]

export default function PortfolioPage() {
  const navigate = useNavigate()

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portfolio</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select an asset class to manage</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {CATEGORIES.map(cat =>
            cat.status === 'active' ? (
              <div
                key={cat.id}
                onClick={() => cat.path && navigate(cat.path)}
                className="relative rounded-2xl border border-gray-200 bg-white p-6 hover:border-blue-300 hover:shadow-md cursor-pointer group transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-3xl mb-4 transition-colors">
                  {cat.icon}
                </div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">{cat.label}</h2>
                <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-blue-600 group-hover:text-blue-700">
                  Open {cat.label} <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
              </div>
            ) : (
              <div
                key={cat.id}
                className="rounded-2xl border-2 border-dashed border-gray-200 p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[160px] cursor-default"
              >
                <span className="text-3xl opacity-30">{cat.icon}</span>
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
