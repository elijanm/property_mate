import { useState } from 'react'
import PublicShell from '@/layouts/PublicShell'
import CalendlyModal from '@/components/CalendlyModal'

const BLUE = '#1D4ED8'

const ROLES = [
  {
    title: 'Senior Backend Engineer',
    team: 'Engineering',
    location: 'Nairobi (hybrid)',
    type: 'Full-time',
    desc: 'Own the core API, billing engine, and background job infrastructure. FastAPI, MongoDB, Redis, RabbitMQ.',
  },
  {
    title: 'Frontend Engineer',
    team: 'Engineering',
    location: 'Nairobi (hybrid)',
    type: 'Full-time',
    desc: 'Build the interfaces landlords, agents, and tenants use every day. React 18, TypeScript, Tailwind.',
  },
  {
    title: 'Customer Success Manager',
    team: 'Customer Success',
    location: 'Nairobi',
    type: 'Full-time',
    desc: 'Own the onboarding and retention of our fastest-growing property management customers. Speak property, think SaaS.',
  },
  {
    title: 'Sales Development Representative',
    team: 'Sales',
    location: 'Nairobi',
    type: 'Full-time',
    desc: 'Find and qualify property managers and landlords across East Africa. Outbound, inbound, referrals — all of the above.',
  },
]

const PERKS = [
  { icon: '🏥', title: 'Medical cover', desc: 'Comprehensive inpatient and outpatient cover for you and your dependants.' },
  { icon: '🌍', title: 'Remote-friendly', desc: 'Work from our Nairobi office, from home, or a mix. We care about output, not attendance.' },
  { icon: '📚', title: 'Learning budget', desc: 'KES 50,000/year for courses, books, and conferences.' },
  { icon: '💻', title: 'Equipment stipend', desc: 'A laptop and peripheral setup of your choice on day one.' },
  { icon: '📈', title: 'Equity options', desc: 'Share in the upside you\'re helping to create.' },
  { icon: '🏖️', title: '25 days leave', desc: 'Plus public holidays. We mean it — take your leave.' },
]

export default function CareersPage() {
  const [calendlyOpen, setCalendlyOpen] = useState(false)

  return (
    <PublicShell>
      <CalendlyModal open={calendlyOpen} onClose={() => setCalendlyOpen(false)} />

      {/* Header */}
      <div className="border-b border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">Careers</p>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Build the future of property management in Africa.</h1>
          <p className="mt-3 text-sm text-gray-500 leading-relaxed max-w-xl mx-auto">
            We're a small team building software that genuinely changes how landlords and property managers work.
            We hire people who care about craft, move fast, and want to see the impact of their work.
          </p>
        </div>
      </div>

      {/* Open roles */}
      <div className="py-10 border-b border-gray-100">
        <div className="mx-auto max-w-4xl px-5">
          <h2 className="text-lg font-bold text-gray-900 mb-5">Open roles</h2>
          <div className="space-y-3">
            {ROLES.map(role => (
              <div key={role.title} className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-sm hover:border-gray-300 transition-all">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{role.team}</span>
                      <span className="text-[10px] text-gray-400">·</span>
                      <span className="text-[10px] text-gray-500">{role.location}</span>
                      <span className="text-[10px] text-gray-400">·</span>
                      <span className="text-[10px] text-gray-500">{role.type}</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-900 mb-1">{role.title}</h3>
                    <p className="text-[13px] text-gray-500">{role.desc}</p>
                  </div>
                  <a
                    href={`mailto:careers@faharicloud.com?subject=Application: ${role.title}`}
                    className="shrink-0 rounded-md px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 transition"
                    style={{ backgroundColor: BLUE }}
                  >
                    Apply
                  </a>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-sm text-gray-500">
            Don't see your role?{' '}
            <a href="mailto:careers@faharicloud.com" className="text-blue-600 font-medium hover:text-blue-700">
              Send us your CV anyway.
            </a>
            {' '}We sometimes hire for roles before we post them.
          </p>
        </div>
      </div>

      {/* Perks */}
      <div className="py-10 border-b border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-4xl px-5">
          <h2 className="text-lg font-bold text-gray-900 mb-5">Why FahariCloud</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PERKS.map(p => (
              <div key={p.title} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xl mb-2">{p.icon}</div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">{p.title}</h3>
                <p className="text-[12px] text-gray-500 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-10">
        <div className="mx-auto max-w-xl px-5 text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Want to learn more before applying?</h2>
          <p className="text-sm text-gray-500 mb-5">Book a 20-minute call with our hiring team. No commitment, just a conversation.</p>
          <button
            onClick={() => setCalendlyOpen(true)}
            className="rounded-md px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
            style={{ backgroundColor: BLUE }}
          >
            Schedule a call
          </button>
        </div>
      </div>
    </PublicShell>
  )
}
