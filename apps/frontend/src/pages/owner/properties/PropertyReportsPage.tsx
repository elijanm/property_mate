import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProperty } from '@/context/PropertyContext'
import { getPropertyColor } from '@/layouts/PropertyWorkspaceLayout'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'

type ReportCategory =
  | 'all'
  | 'financial'
  | 'tenant'
  | 'occupancy'
  | 'maintenance'
  | 'utility'
  | 'billing'

interface ReportDef {
  id: string
  title: string
  description: string
  category: Exclude<ReportCategory, 'all'>
  icon: string
  available: boolean
  tags?: string[]
}

const REPORTS: ReportDef[] = [
  // Financial
  {
    id: 'rent-roll',
    title: 'Rent Roll',
    description: 'All active leases with unit, tenant, monthly rent, lease start/end dates, and vacancy status.',
    category: 'financial',
    icon: '📋',
    available: true,
    tags: ['leases', 'rent', 'units'],
  },
  {
    id: 'income-statement',
    title: 'Income Statement (P&L)',
    description: 'Total rental income, utility revenue, credits, and adjustments versus operating expenses for a given period.',
    category: 'financial',
    icon: '📈',
    available: false,
    tags: ['invoices', 'payments'],
  },
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    description: 'Snapshot of tenant receivables (outstanding invoices) versus ledger liabilities at any point in time.',
    category: 'financial',
    icon: '⚖️',
    available: false,
    tags: ['ledger', 'invoices'],
  },
  {
    id: 'cash-flow',
    title: 'Cash Flow Statement',
    description: 'Actual money received (payments) versus disbursements (refunds, payouts) over a selected period.',
    category: 'financial',
    icon: '💸',
    available: false,
    tags: ['payments', 'ledger'],
  },
  {
    id: 'arrears',
    title: 'Arrears Report',
    description: 'Tenants with overdue balances grouped by age buckets: 0–30, 31–60, 61–90, and 90+ days.',
    category: 'financial',
    icon: '⚠️',
    available: true,
    tags: ['invoices', 'overdue'],
  },
  {
    id: 'tax-summary',
    title: 'Tax Summary (VAT)',
    description: 'VAT collected per billing period, itemised by tax rate and revenue category for compliance reporting.',
    category: 'financial',
    icon: '🏛️',
    available: false,
    tags: ['tax', 'invoices'],
  },
  {
    id: 'collection-rate',
    title: 'Collection Rate Report',
    description: 'Percentage of invoices paid on time vs overdue, with trend over the last 12 months.',
    category: 'financial',
    icon: '📊',
    available: true,
    tags: ['invoices', 'payments'],
  },
  {
    id: 'outstanding-balances',
    title: 'Outstanding Balances',
    description: 'Current balance_due per tenant sorted by highest unpaid amount, with last payment date.',
    category: 'financial',
    icon: '🔴',
    available: true,
    tags: ['invoices', 'tenants'],
  },
  {
    id: 'revenue-by-unit',
    title: 'Revenue by Unit',
    description: 'Rent and utility revenue broken down per unit, comparing invoiced amount to amount actually collected.',
    category: 'financial',
    icon: '🏠',
    available: false,
    tags: ['units', 'invoices'],
  },
  // Tenant & Lease
  {
    id: 'tenant-directory',
    title: 'Tenant Directory',
    description: 'Full list of all tenants with contact info, unit assignment, lease status, and KYC verification status.',
    category: 'tenant',
    icon: '👥',
    available: true,
    tags: ['tenants', 'leases'],
  },
  {
    id: 'tenant-ledger',
    title: 'Tenant Ledger Statement',
    description: 'Per-tenant running ledger of all charges, payments, credits, and carried-forward balances.',
    category: 'tenant',
    icon: '📒',
    available: true,
    tags: ['ledger', 'payments'],
  },
  {
    id: 'lease-expiry',
    title: 'Lease Expiry Report',
    description: 'Leases expiring within 30, 60, or 90 days — helps plan renewals and prevent vacant units.',
    category: 'tenant',
    icon: '📅',
    available: true,
    tags: ['leases'],
  },
  {
    id: 'move-inout',
    title: 'Move-in / Move-out Report',
    description: 'All tenant onboardings (move-ins) and lease terminations (move-outs) for a selected period.',
    category: 'tenant',
    icon: '🚪',
    available: false,
    tags: ['onboarding', 'leases'],
  },
  {
    id: 'payment-behavior',
    title: 'Tenant Payment Behavior',
    description: 'Average payment delay, on-time rate, and reliability score derived from historical invoice payments.',
    category: 'tenant',
    icon: '🧠',
    available: true,
    tags: ['payments', 'tenants'],
  },
  {
    id: 'kyc-status',
    title: 'KYC / ID Status Report',
    description: 'Verification status (pending, verified, rejected) across all tenants with ID type and submission date.',
    category: 'tenant',
    icon: '🪪',
    available: false,
    tags: ['tenants', 'kyc'],
  },
  // Occupancy
  {
    id: 'occupancy',
    title: 'Occupancy Report',
    description: 'Occupied vs vacant unit counts by wing, floor, and unit type with overall occupancy rate.',
    category: 'occupancy',
    icon: '🏢',
    available: true,
    tags: ['units', 'leases'],
  },
  {
    id: 'vacancy-detail',
    title: 'Vacancy Report',
    description: 'Detailed breakdown of each vacant unit — days vacant, estimated rent loss, and last tenant.',
    category: 'occupancy',
    icon: '🚫',
    available: true,
    tags: ['units', 'vacancy'],
  },
  {
    id: 'vacancy-trend',
    title: 'Vacancy Rate Trend',
    description: 'Month-over-month vacancy rate chart derived from billing cycle runs and vacancy report history.',
    category: 'occupancy',
    icon: '📉',
    available: false,
    tags: ['vacancy', 'billing'],
  },
  {
    id: 'lost-revenue',
    title: 'Lost Revenue Report',
    description: 'Estimated rental income lost due to vacancies, calculated from market rent and days vacant.',
    category: 'occupancy',
    icon: '💔',
    available: false,
    tags: ['vacancy', 'financial'],
  },
  // Maintenance
  {
    id: 'ticket-summary',
    title: 'Ticket Summary',
    description: 'Open, assigned, in-progress, pending review, and resolved ticket counts by category and property.',
    category: 'maintenance',
    icon: '🔧',
    available: false,
    tags: ['tickets'],
  },
  {
    id: 'tickets-by-priority',
    title: 'Open Tickets by Priority',
    description: 'All open tickets grouped by urgent / high / normal / low priority with SLA breach flags.',
    category: 'maintenance',
    icon: '🚨',
    available: false,
    tags: ['tickets', 'priority'],
  },
  {
    id: 'sp-performance',
    title: 'Service Provider Performance',
    description: 'Per-SP ticket assignments, average time-to-resolution, re-open rate, and pending ticket count.',
    category: 'maintenance',
    icon: '🛠️',
    available: false,
    tags: ['tickets', 'service_providers'],
  },
  {
    id: 'maintenance-cost',
    title: 'Maintenance Cost Report',
    description: 'Estimated maintenance spend by category (plumbing, electrical, cleaning) over a selected period.',
    category: 'maintenance',
    icon: '💰',
    available: false,
    tags: ['tickets', 'costs'],
  },
  // Utility
  {
    id: 'meter-readings',
    title: 'Meter Reading Report',
    description: 'Current and previous meter readings per unit, consumption, and reading status (confirmed/pending).',
    category: 'utility',
    icon: '🔌',
    available: true,
    tags: ['metering', 'units'],
  },
  {
    id: 'utility-consumption',
    title: 'Utility Consumption Report',
    description: 'Total consumption by utility type (water, electricity, gas) per unit across billing periods.',
    category: 'utility',
    icon: '💧',
    available: true,
    tags: ['metering', 'billing'],
  },
  {
    id: 'utility-cost',
    title: 'Utility Cost Analysis',
    description: 'Utility billing breakdown — tiered vs flat rate, cost per unit, and cost share by tenant.',
    category: 'utility',
    icon: '⚡',
    available: false,
    tags: ['metering', 'invoices'],
  },
  {
    id: 'metering-compliance',
    title: 'Metering Compliance',
    description: 'Units with pending, overdue, or missing meter readings that are blocking invoice finalisation.',
    category: 'utility',
    icon: '📡',
    available: false,
    tags: ['metering', 'tickets'],
  },
  // Billing
  {
    id: 'invoice-summary',
    title: 'Invoice Summary',
    description: 'All invoices for a billing period by status: draft, ready, sent, partial paid, paid, overdue, void.',
    category: 'billing',
    icon: '🧾',
    available: false,
    tags: ['invoices'],
  },
  {
    id: 'billing-cycle-history',
    title: 'Billing Cycle History',
    description: 'History of all billing runs with invoices created, skipped, failed, and run type (manual/auto).',
    category: 'billing',
    icon: '🔄',
    available: false,
    tags: ['billing', 'invoices'],
  },
  {
    id: 'vacancy-loss',
    title: 'Vacancy Loss Report',
    description: 'Estimated revenue lost from vacant units over a period, with per-unit breakdown.',
    category: 'occupancy',
    icon: '🏚️',
    available: true,
    tags: ['vacancy', 'revenue'],
  },
  {
    id: 'expiry-calendar',
    title: 'Lease Expiry Calendar',
    description: 'Upcoming lease expirations by unit, color-coded by urgency (30/60/90 days).',
    category: 'tenant',
    icon: '📅',
    available: true,
    tags: ['lease', 'expiry'],
  },
  {
    id: 'payment-scorecard',
    title: 'Tenant Payment Scorecard',
    description: 'Per-tenant on-time payment rate and ranking — identifies reliable vs at-risk tenants.',
    category: 'tenant',
    icon: '🏆',
    available: true,
    tags: ['payments', 'tenants'],
  },
  {
    id: 'discount-impact',
    title: 'Discount Impact Report',
    description: 'Total rent discounts given — monthly savings and cumulative cost per discount programme.',
    category: 'financial',
    icon: '🏷️',
    available: true,
    tags: ['discounts', 'revenue'],
  },
  {
    id: 'payment-methods',
    title: 'Payment Methods Analysis',
    description: 'Breakdown of payments by method (Mpesa, bank transfer, cash) with totals and trend over time.',
    category: 'billing',
    icon: '💳',
    available: false,
    tags: ['payments'],
  },
  {
    id: 'refunds-credits',
    title: 'Refunds & Credits Report',
    description: 'All credit notes, manual adjustments, and refund transactions with reason and authorising user.',
    category: 'billing',
    icon: '↩️',
    available: false,
    tags: ['invoices', 'payments'],
  },
]

const CATEGORY_META: Record<
  Exclude<ReportCategory, 'all'>,
  { label: string; color: string; bg: string; border: string }
> = {
  financial:   { label: 'Financial',   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  tenant:      { label: 'Tenant',      color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  occupancy:   { label: 'Occupancy',   color: 'text-emerald-700',bg: 'bg-emerald-50',border: 'border-emerald-200' },
  maintenance: { label: 'Maintenance', color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  utility:     { label: 'Utility',     color: 'text-cyan-700',   bg: 'bg-cyan-50',   border: 'border-cyan-200' },
  billing:     { label: 'Billing',     color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
}

const CATEGORY_ACCENT: Record<Exclude<ReportCategory, 'all'>, string> = {
  financial:   'bg-blue-500',
  tenant:      'bg-violet-500',
  occupancy:   'bg-emerald-500',
  maintenance: 'bg-amber-500',
  utility:     'bg-cyan-500',
  billing:     'bg-indigo-500',
}

const CATEGORIES: { key: ReportCategory; label: string }[] = [
  { key: 'all',         label: 'All Reports' },
  { key: 'financial',  label: 'Financial' },
  { key: 'tenant',     label: 'Tenant & Lease' },
  { key: 'occupancy',  label: 'Occupancy' },
  { key: 'maintenance',label: 'Maintenance' },
  { key: 'utility',    label: 'Utility' },
  { key: 'billing',    label: 'Billing' },
]

const REPORT_ROUTES: Partial<Record<string, string>> = {
  'rent-roll':            'rent-roll',
  'arrears':              'arrears',
  'collection-rate':      'collection-rate',
  'outstanding-balances': 'outstanding-balances',
  'lease-expiry':         'lease-expiry',
  'payment-behavior':     'payment-behavior',
  'occupancy':            'occupancy',
  'vacancy-detail':       'vacancy-detail',
  'utility-consumption':  'utility-consumption',
  'meter-readings':       'meter-readings',
  'vacancy-loss':         'reports/vacancy-loss',
  'expiry-calendar':      'reports/expiry-calendar',
  'payment-scorecard':    'reports/payment-scorecard',
  'discount-impact':      'reports/discount-impact',
}

function ReportCard({ report, color }: { report: ReportDef; color: string }) {
  const navigate = useNavigate()
  const meta = CATEGORY_META[report.category]
  const accent = CATEGORY_ACCENT[report.category]

  return (
    <div
      className={[
        'relative bg-white rounded-xl border overflow-hidden flex flex-col transition-shadow',
        report.available
          ? 'border-gray-200 hover:shadow-md group'
          : 'border-gray-100 opacity-50',
      ].join(' ')}
    >
      {/* Category accent bar */}
      <div className={`h-1 w-full ${accent}`} />

      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <span className={`text-2xl ${!report.available ? 'grayscale' : ''}`}>
              {report.icon}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 leading-tight">{report.title}</h3>
              <span
                className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}
              >
                {meta.label}
              </span>
            </div>
          </div>
          {!report.available && (
            <span className="shrink-0 text-[10px] font-semibold text-gray-400 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
              Coming Soon
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 leading-relaxed flex-1">{report.description}</p>

        {report.tags && (
          <div className="mt-3 flex flex-wrap gap-1">
            {report.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4">
          {report.available ? (
            <button
              onClick={() => {
                const route = REPORT_ROUTES[report.id]
                if (route) navigate(route)
              }}
              className="w-full py-2 px-3 text-xs font-semibold text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: color }}
            >
              Generate Report
            </button>
          ) : (
            <button
              disabled
              className="w-full py-2 px-3 text-xs font-semibold text-gray-300 bg-gray-50 border border-gray-100 rounded-lg cursor-not-allowed"
            >
              Not available yet
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PropertyReportsPage() {
  const property = useProperty()
  const color = getPropertyColor(property ?? ({} as never))
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ReportCategory>('all')
  const [showComingSoon, setShowComingSoon] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return REPORTS.filter((r) => {
      if (!showComingSoon && !r.available) return false
      const matchesCategory = category === 'all' || r.category === category
      const matchesSearch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(q))
      return matchesCategory && matchesSearch
    })
  }, [search, category, showComingSoon])

  const availableCount = REPORTS.filter((r) => r.available).length
  const totalCount = REPORTS.length

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PropertyBreadcrumb page="Reports" />
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate financial, operational, and compliance reports from your property data.
        </p>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': color } as React.CSSProperties}
          />
        </div>

        {/* Coming soon toggle */}
        <button
          onClick={() => setShowComingSoon((v) => !v)}
          className={[
            'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors shrink-0',
            showComingSoon
              ? 'text-white border-transparent'
              : 'text-gray-500 border-gray-200 hover:bg-gray-50',
          ].join(' ')}
          style={showComingSoon ? { backgroundColor: color } : undefined}
        >
          <span>{showComingSoon ? '✦' : '○'}</span>
          Coming Soon
        </button>

        <p className="text-sm text-gray-400 self-center shrink-0">
          {availableCount} of {totalCount} available
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap mb-6 border-b border-gray-200 pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={[
              'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
              category === c.key
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
            ].join(' ')}
            style={category === c.key ? { backgroundColor: color } : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-gray-500 text-sm">No reports match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((r) => (
            <ReportCard key={r.id} report={r} color={color} />
          ))}
        </div>
      )}
    </div>
  )
}
