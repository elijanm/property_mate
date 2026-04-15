import PublicShell from '@/layouts/PublicShell'

const ENTRIES = [
  {
    version: '2.4.0',
    date: 'April 2025',
    badge: 'Latest',
    badgeColor: 'bg-green-100 text-green-700',
    changes: [
      { type: 'New',  label: 'AI voice agent with 10 tenant tools (balance, STK push, ticket creation, lease copy)' },
      { type: 'New',  label: 'IoT smart meter integration via EMQX broker — readings auto-applied to invoices' },
      { type: 'New',  label: 'Vendor management module: listings, applications, contracts, portal for service providers' },
      { type: 'Improved', label: 'Invoice PDF redesigned — tiered utility breakdown, meter photo evidence, usage history chart' },
      { type: 'Improved', label: 'Lease lifecycle: discounts, rent escalations, co-tenants, renewal offers, move-out inspections' },
      { type: 'Fixed', label: 'Prorated rent calculation edge case when lease starts on the last day of the month' },
    ],
  },
  {
    version: '2.3.0',
    date: 'March 2025',
    badge: null,
    badgeColor: '',
    changes: [
      { type: 'New',  label: 'Serialized inventory with shipment tracking and waybill PDF generation' },
      { type: 'New',  label: 'Store management: hierarchical store → aisle → bay → face location system' },
      { type: 'New',  label: 'Asset management with depreciation, assignments, and store location tracking' },
      { type: 'New',  label: 'Per-serial pricing at stock-in with margin % calculation' },
      { type: 'Improved', label: 'Inventory variants with image upload and per-variant pricing' },
      { type: 'Improved', label: 'Stock-out partial dispatch creates child serial automatically' },
    ],
  },
  {
    version: '2.2.0',
    date: 'February 2025',
    badge: null,
    badgeColor: '',
    changes: [
      { type: 'New',  label: 'One-time meter reading wizard for field agents — camera capture + AI reading extraction' },
      { type: 'New',  label: 'Ticket task submission page for external service providers (public URL, no login required)' },
      { type: 'New',  label: 'Mpesa B2C payouts for service provider settlement on ticket completion' },
      { type: 'Improved', label: 'Billing run now creates one consolidated ticket per property (not per invoice)' },
      { type: 'Improved', label: 'InvoiceDetailSlideOver shows meter photo, current/previous reading, and usage per line item' },
      { type: 'Fixed', label: 'Unit meter_reading_cache not updating after field reading submission' },
    ],
  },
  {
    version: '2.1.0',
    date: 'January 2025',
    badge: null,
    badgeColor: '',
    changes: [
      { type: 'New',  label: 'Professional lease PDF — Kenya-standard tenancy agreement with e-signature verification annex' },
      { type: 'New',  label: 'Owner countersignature on lease PDF after tenant signs' },
      { type: 'New',  label: 'Canvas-based signature pad for org and property letterhead signatures' },
      { type: 'New',  label: 'Document verification page — verify lease authenticity by OTP or PDF upload (SHA-256 comparison)' },
      { type: 'Improved', label: 'Onboarding wizard reordered: KYC → Lease → Pay → Sign (deposit required before signing)' },
      { type: 'Improved', label: 'Global error toast system — all API errors surface automatically' },
    ],
  },
  {
    version: '2.0.0',
    date: 'December 2024',
    badge: null,
    badgeColor: '',
    changes: [
      { type: 'New',  label: 'MFA (TOTP) with per-user setup, session tokens, and PII masking behind MFA gate' },
      { type: 'New',  label: 'Comprehensive ticketing: ticket categories, bulk operations, public task token, SLA tracking' },
      { type: 'New',  label: 'WebSocket notification system with sound alerts and notification center' },
      { type: 'New',  label: 'Professional invoice PDF with reportlab platypus — page 1: invoice, page 2: usage analytics' },
      { type: 'New',  label: 'Accounting module: ledger, billing cycle runs, vacancy reports, APScheduler auto-generation' },
      { type: 'Improved', label: 'Property workspace: color-coded cards, nested routes, full sidebar navigation' },
    ],
  },
]

const TYPE_COLORS: Record<string, string> = {
  New:      'bg-blue-100 text-blue-700',
  Improved: 'bg-amber-100 text-amber-700',
  Fixed:    'bg-green-100 text-green-700',
}

export default function ChangelogPage() {
  return (
    <PublicShell>
      <div className="border-b border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-3xl px-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">Changelog</p>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">What's new in FahariCloud</h1>
          <p className="mt-2 text-sm text-gray-500">
            Release notes for every update we ship. Subscribe to{' '}
            <a href="mailto:hello@faharicloud.com?subject=Subscribe to changelog" className="text-blue-600 hover:underline">
              email updates
            </a>{' '}
            to be notified when we release.
          </p>
        </div>
      </div>

      <div className="py-10">
        <div className="mx-auto max-w-3xl px-5">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-2 bottom-0 w-px bg-gray-200" />

            <div className="space-y-10">
              {ENTRIES.map(entry => (
                <div key={entry.version} className="relative pl-7">
                  {/* Timeline dot */}
                  <div className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-gray-400 ring-2 ring-gray-200" />

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <h2 className="text-base font-bold text-gray-900">v{entry.version}</h2>
                    {entry.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.badgeColor}`}>
                        {entry.badge}
                      </span>
                    )}
                    <span className="text-sm text-gray-400">{entry.date}</span>
                  </div>

                  <ul className="space-y-2">
                    {entry.changes.map((c, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TYPE_COLORS[c.type]}`}>
                          {c.type}
                        </span>
                        <span className="text-sm text-gray-600 leading-relaxed">{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  )
}
