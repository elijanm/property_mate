import { useState } from 'react'
import { Link } from 'react-router-dom'
import PublicShell from '@/layouts/PublicShell'
import CalendlyModal from '@/components/CalendlyModal'

const BLUE = '#1D4ED8'

function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function Dash() {
  return <div className="h-0.5 w-4 shrink-0 rounded-full bg-gray-300" />
}

const PLANS = [
  {
    name: 'Starter',
    tagline: 'For independent landlords',
    price: 'KES 2,500',
    period: '/ month',
    description: 'Everything you need to move off spreadsheets and start collecting rent digitally.',
    cta: 'Start free trial',
    ctaTo: '/signup',
    highlight: false,
    badge: null,
    features: [
      { label: 'Up to 20 units',                  included: true  },
      { label: '1 property',                       included: true  },
      { label: 'Digital lease creation',           included: true  },
      { label: 'Mpesa rent collection',            included: true  },
      { label: 'Tenant self-service portal',       included: true  },
      { label: 'Maintenance ticketing',            included: true  },
      { label: 'Invoice generation',               included: true  },
      { label: 'Basic financial reports',          included: true  },
      { label: 'Utility billing',                  included: false },
      { label: 'IoT meter reading',                included: false },
      { label: 'Agent & staff accounts',           included: false },
      { label: 'AI voice agent',                   included: false },
      { label: 'Commission & payout management',   included: false },
      { label: 'API access',                       included: false },
    ],
  },
  {
    name: 'Professional',
    tagline: 'For growing agencies',
    price: 'KES 7,500',
    period: '/ month',
    description: 'Full feature access for agencies managing multiple properties with teams.',
    cta: 'Start free trial',
    ctaTo: '/signup',
    highlight: true,
    badge: 'Most popular',
    features: [
      { label: 'Up to 200 units',                  included: true  },
      { label: 'Up to 10 properties',              included: true  },
      { label: 'Digital lease creation',           included: true  },
      { label: 'Mpesa rent collection',            included: true  },
      { label: 'Tenant self-service portal',       included: true  },
      { label: 'Maintenance ticketing',            included: true  },
      { label: 'Invoice generation',               included: true  },
      { label: 'Advanced financial reports',       included: true  },
      { label: 'Utility billing & metering',       included: true  },
      { label: 'IoT meter reading',                included: true  },
      { label: 'Up to 5 agent accounts',           included: true  },
      { label: 'AI voice agent',                   included: false },
      { label: 'Commission & payout management',   included: true  },
      { label: 'API access',                       included: false },
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'For large portfolios',
    price: 'Custom',
    period: '',
    description: 'Unlimited properties, dedicated support, custom integrations, and SLA guarantees.',
    cta: 'Book a demo',
    ctaTo: null, // opens Calendly
    highlight: false,
    badge: null,
    features: [
      { label: 'Unlimited units',                  included: true  },
      { label: 'Unlimited properties',             included: true  },
      { label: 'Digital lease creation',           included: true  },
      { label: 'Mpesa rent collection',            included: true  },
      { label: 'Tenant self-service portal',       included: true  },
      { label: 'Maintenance ticketing',            included: true  },
      { label: 'Invoice generation',               included: true  },
      { label: 'Advanced financial reports',       included: true  },
      { label: 'Utility billing & metering',       included: true  },
      { label: 'IoT meter reading',                included: true  },
      { label: 'Unlimited agent accounts',         included: true  },
      { label: 'AI voice agent',                   included: true  },
      { label: 'Commission & payout management',   included: true  },
      { label: 'API access & webhooks',            included: true  },
    ],
  },
]

const FAQS = [
  {
    q: 'Is there a free trial?',
    a: 'Yes. Starter and Professional plans both include a 14-day free trial — no credit card required. You can invite tenants, create properties, and generate invoices during the trial.',
  },
  {
    q: 'How does Mpesa integration work?',
    a: 'FahariCloud connects to Mpesa C2B (customer-to-business) paybill numbers. When tenants pay rent, the payment is automatically matched to the correct invoice and the tenant\'s ledger is updated in real time.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. You can upgrade or downgrade at any time. Upgrades take effect immediately. Downgrades take effect at the start of the next billing cycle.',
  },
  {
    q: 'What happens if I exceed my unit limit?',
    a: 'We\'ll notify you when you approach your limit. You can upgrade your plan at any time to accommodate more units — no interruption to existing tenants or data.',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. All data is encrypted in transit (TLS) and at rest. We use MongoDB with replica sets, regular automated backups, and S3-compatible storage for documents. Your tenant ID documents and signed leases are stored securely and never shared.',
  },
  {
    q: 'Do you support multiple currencies?',
    a: 'FahariCloud natively supports KES, UGX, TZS, RWF, and ETB. Our global SparcCloud variant supports any currency. Contact us if you need multi-currency within a single portfolio.',
  },
  {
    q: 'What\'s included in the Enterprise demo?',
    a: 'A 30-minute walkthrough of the platform with one of our team — tailored to your portfolio size, property types, and any specific workflows you need. We\'ll also discuss custom pricing, API access, and dedicated support options.',
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-200 last:border-0">
      <button
        className="flex w-full items-start justify-between py-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-semibold text-gray-900 pr-4">{q}</span>
        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-45' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {open && <p className="pb-4 text-sm text-gray-500 leading-relaxed">{a}</p>}
    </div>
  )
}

export default function PricingPage() {
  const [calendlyOpen, setCalendlyOpen] = useState(false)

  return (
    <PublicShell>
      <CalendlyModal open={calendlyOpen} onClose={() => setCalendlyOpen(false)} />

      {/* Hero */}
      <div className="border-b border-gray-100 bg-gray-50 py-12">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Pricing</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">Simple, transparent pricing</h1>
          <p className="mt-3 text-base text-gray-500">
            Start free. Scale as your portfolio grows. No hidden fees, no long-term contracts.
          </p>
        </div>
      </div>

      {/* Plans */}
      <div className="py-12">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-6 lg:grid-cols-3">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                className={`relative rounded-lg border bg-white p-6 flex flex-col ${
                  plan.highlight
                    ? 'border-blue-600 shadow-lg ring-1 ring-blue-600'
                    : 'border-gray-200 shadow-sm'
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full px-3 py-1 text-[11px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: BLUE }}>
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{plan.tagline}</p>
                  <h2 className="text-xl font-bold text-gray-900">{plan.name}</h2>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className={`text-3xl font-black ${plan.highlight ? 'text-blue-700' : 'text-gray-900'}`}>
                      {plan.price}
                    </span>
                    {plan.period && <span className="text-sm text-gray-400">{plan.period}</span>}
                  </div>
                  <p className="mt-2 text-[13px] text-gray-500 leading-relaxed">{plan.description}</p>
                </div>

                {plan.ctaTo ? (
                  <Link
                    to={plan.ctaTo}
                    className={`mb-6 block rounded-md py-2.5 text-center text-sm font-semibold transition hover:opacity-90 ${
                      plan.highlight ? 'text-white' : 'text-white'
                    }`}
                    style={{ backgroundColor: plan.highlight ? BLUE : '#374151' }}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <button
                    onClick={() => setCalendlyOpen(true)}
                    className="mb-6 block w-full rounded-md py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ backgroundColor: '#374151' }}
                  >
                    {plan.cta}
                  </button>
                )}

                <ul className="space-y-2.5 flex-1">
                  {plan.features.map(f => (
                    <li key={f.label} className={`flex items-center gap-2.5 text-[13px] ${f.included ? 'text-gray-700' : 'text-gray-300'}`}>
                      {f.included ? <Check /> : <Dash />}
                      {f.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-gray-400">
            All plans include a 14-day free trial. Prices exclude VAT where applicable.
            Enterprise pricing is billed annually.
          </p>
        </div>
      </div>

      {/* Compare all features CTA */}
      <div className="border-y border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h3 className="text-base font-bold text-gray-900">Need a walkthrough?</h3>
              <p className="mt-1 text-sm text-gray-500">
                Our team will show you exactly how FahariCloud fits your portfolio — no sales pressure, just clarity.
              </p>
            </div>
            <button
              onClick={() => setCalendlyOpen(true)}
              className="shrink-0 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: BLUE }}
            >
              Book a free demo
            </button>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="py-12">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Frequently asked questions</h2>
          {FAQS.map(faq => <FaqItem key={faq.q} q={faq.q} a={faq.a} />)}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="border-t border-gray-100 bg-gray-900 py-10">
        <div className="mx-auto max-w-6xl px-5 flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <h3 className="text-base font-bold text-white">Ready to get started?</h3>
            <p className="mt-1 text-sm text-gray-400">14-day free trial. No credit card required.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/signup" className="rounded-md px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
                  style={{ backgroundColor: BLUE }}>
              Start free trial
            </Link>
            <button onClick={() => setCalendlyOpen(true)}
                    className="rounded-md border border-gray-600 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:border-gray-400 hover:text-white transition">
              Book a demo
            </button>
          </div>
        </div>
      </div>
    </PublicShell>
  )
}
