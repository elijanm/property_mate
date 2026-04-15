import { useParams } from 'react-router-dom'

interface ReportCard {
  key: string
  title: string
  description: string
  icon: string
  category: string
  status: 'available' | 'coming_soon'
}

const REPORTS: ReportCard[] = [
  // Operational
  { key: 'monthly-activity', title: 'Monthly Activity Report', description: 'Summary of all maintenance visits, work orders completed, and parts used in the month.', icon: '📋', category: 'Operational', status: 'available' },
  { key: 'biannual-service', title: 'Biannual Service Report (PPM)', description: 'Full PPM-A and PPM-B service summary per asset — checks done, findings, parts replaced.', icon: '🔧', category: 'Operational', status: 'available' },
  { key: 'work-order-completion', title: 'Work Order Completion Rate', description: 'Percentage of work orders completed on time vs delayed, by region and service provider.', icon: '✅', category: 'Operational', status: 'available' },
  { key: 'schedule-adherence', title: 'Schedule Adherence Report', description: 'Planned vs actual service dates. Highlights overdue and missed maintenance windows.', icon: '📅', category: 'Operational', status: 'available' },
  // Asset Health
  { key: 'asset-health', title: 'Asset Health Dashboard', description: 'Current operational status of all assets: operational, fault, standby, decommissioned.', icon: '⚡', category: 'Asset Health', status: 'available' },
  { key: 'fault-history', title: 'Fault History & Recurrence', description: 'Recurring fault patterns per asset. Identifies chronic problem sites.', icon: '🔴', category: 'Asset Health', status: 'available' },
  { key: 'lifecycle-report', title: 'Asset Lifecycle Report', description: 'Installation dates, runtime hours, warranty status, and recommended replacement timeline.', icon: '⏱️', category: 'Asset Health', status: 'available' },
  // Financial
  { key: 'cost-analysis', title: 'Cost Analysis Report', description: 'Total cost breakdown: parts + labour + transport + accommodation per asset and per region.', icon: '💰', category: 'Financial', status: 'available' },
  { key: 'parts-consumption', title: 'Parts Consumption Report', description: 'Spare parts used per asset, per KVA range, and per service visit. Tracks inventory burn rate.', icon: '📦', category: 'Financial', status: 'available' },
  { key: 'penalty-exposure', title: 'SLA Penalty & Financial Exposure', description: 'Penalties incurred per quarter by SLA breach type, with cumulative financial impact.', icon: '⚠️', category: 'Financial', status: 'available' },
  { key: 'transport-costs', title: 'Transport & Accommodation Costs', description: 'Travel costs by region (road vs air), accommodation charges, and cost-per-visit analysis.', icon: '🚗', category: 'Financial', status: 'available' },
  // SLA
  { key: 'sla-scorecard', title: 'SLA Performance Scorecard', description: 'Quarter-by-quarter SLA level per asset with trend arrows. Identifies degrading sites.', icon: '📊', category: 'SLA & Compliance', status: 'available' },
  { key: 'response-time', title: 'Response Time Analysis', description: 'Average response and resolution times for emergency and routine callouts by technician and region.', icon: '⏰', category: 'SLA & Compliance', status: 'available' },
  { key: 'compliance-certificate', title: 'Compliance Certificate Pack', description: 'Generates client-ready compliance documentation for contract review.', icon: '📜', category: 'SLA & Compliance', status: 'coming_soon' },
  // Planning
  { key: 'route-efficiency', title: 'Route Efficiency Report', description: 'Distance and time analysis for service routes. Identifies route optimisation opportunities.', icon: '🗺️', category: 'Planning', status: 'available' },
  { key: 'resource-utilization', title: 'Technician Utilisation Report', description: 'Hours worked per technician, sites visited, and idle time analysis.', icon: '👷', category: 'Planning', status: 'coming_soon' },
  { key: 'kva-parts-matrix', title: 'KVA Parts Pricing Matrix', description: 'Exported pricing sheet by KVA range for client invoicing and cost estimation.', icon: '💹', category: 'Planning', status: 'available' },
]

const CATEGORIES = [...new Set(REPORTS.map(r => r.category))]

const CATEGORY_COLORS: Record<string, string> = {
  Operational: 'bg-blue-50 text-blue-700',
  'Asset Health': 'bg-amber-50 text-amber-700',
  Financial: 'bg-green-50 text-green-700',
  'SLA & Compliance': 'bg-red-50 text-red-700',
  Planning: 'bg-indigo-50 text-indigo-700',
}

export default function FrameworkReportsPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()

  function handleOpenReport(key: string) {
    // Navigate to the specific report page (coming in future iteration)
    console.info('Opening report:', key, 'for framework:', frameworkId)
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {REPORTS.filter(r => r.status === 'available').length} reports available · {REPORTS.filter(r => r.status === 'coming_soon').length} coming soon
        </p>
      </div>

      {CATEGORIES.map(category => {
        const items = REPORTS.filter(r => r.category === category)
        return (
          <div key={category} className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
              <span className={`px-2 py-0.5 rounded text-[10px] ${CATEGORY_COLORS[category] ?? 'bg-gray-100 text-gray-600'}`}>
                {category}
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(report => (
                <div
                  key={report.key}
                  onClick={() => report.status === 'available' && handleOpenReport(report.key)}
                  className={`bg-white rounded-xl border p-5 transition-all ${
                    report.status === 'available'
                      ? 'border-gray-200 hover:border-amber-300 hover:shadow-md cursor-pointer group'
                      : 'border-dashed border-gray-200 opacity-70 cursor-default'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-2xl">{report.icon}</span>
                    {report.status === 'coming_soon' && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        Soon
                      </span>
                    )}
                  </div>
                  <h3 className={`text-sm font-bold mb-1 transition-colors ${
                    report.status === 'available' ? 'text-gray-900 group-hover:text-amber-700' : 'text-gray-500'
                  }`}>
                    {report.title}
                  </h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{report.description}</p>
                  {report.status === 'available' && (
                    <div className="mt-3 flex items-center gap-1 text-xs font-medium text-amber-600 group-hover:text-amber-700">
                      Open report
                      <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
