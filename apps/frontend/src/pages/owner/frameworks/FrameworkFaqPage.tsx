import { useState } from 'react'

// ── Data ─────────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string
  a: string | JSX.Element
}

interface FaqSection {
  title: string
  icon: string
  items: FaqItem[]
}

const SERVICE_TYPES = [
  {
    code: 'biannual_a',
    label: 'PPM-A',
    full: 'Planned Preventive Maintenance A',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
    badge: 'bg-blue-100 text-blue-700',
    description: 'Full service visit performed twice a year. Covers oil & filter changes, load bank testing, coolant check, air filter replacement, belt inspection, and consumables replacement. Result: a comprehensive service report.',
    frequency: '2× per year',
    cost: 'Cost A in Schedule 4',
  },
  {
    code: 'biannual_b',
    label: 'PPM-B',
    full: 'Planned Preventive Maintenance B',
    color: 'bg-purple-50 border-purple-200 text-purple-800',
    badge: 'bg-purple-100 text-purple-700',
    description: 'Technical inspection visit performed twice a year. Covers visual checks, meter readings, battery condition, fuel level, operational parameters, and a condition report with recommendations. No major work — observation and reporting.',
    frequency: '2× per year',
    cost: 'Cost B in Schedule 4',
  },
  {
    code: 'quarterly',
    label: 'Quarterly Check',
    full: 'Quarterly Inspection',
    color: 'bg-green-50 border-green-200 text-green-800',
    badge: 'bg-green-100 text-green-700',
    description: 'Lighter check every 3 months. Covers battery voltage test, fuel level, run test under load, coolant top-up, and a brief condition log. Keeps the generator ready between full PPM visits.',
    frequency: '4× per year',
    cost: 'Included in Cost C (unlimited attendance)',
  },
  {
    code: 'corrective',
    label: 'Corrective Maintenance',
    full: 'Corrective / Reactive Maintenance',
    color: 'bg-orange-50 border-orange-200 text-orange-800',
    badge: 'bg-orange-100 text-orange-700',
    description: 'Reactive visit triggered when a fault or failure is reported. Technician diagnoses and repairs the problem. May require a Pre-Inspection (parts approval) before work begins if spare parts are needed.',
    frequency: 'As needed',
    cost: 'Included in Cost C (unlimited attendance)',
  },
  {
    code: 'emergency',
    label: 'Emergency Callout',
    full: 'Emergency Callout',
    color: 'bg-red-50 border-red-200 text-red-800',
    badge: 'bg-red-100 text-red-700',
    description: 'Urgent response when a generator fails during a critical period. SLA response time applies (usually 4–8 hours). Recorded as an SLA event; delays attract penalty percentages per the contract.',
    frequency: 'As needed (SLA-governed)',
    cost: 'Included in Cost C (unlimited attendance)',
  },
]

const FAQ_SECTIONS: FaqSection[] = [
  {
    title: 'Schedule 4 Pricing',
    icon: '💰',
    items: [
      {
        q: 'What is Schedule 4?',
        a: 'Schedule 4 is the pricing schedule in the framework contract. It lists every site, the generator KVA rating, and the annual cost breakdown into three components: A (PPM services), B (technical inspections), and C (unlimited corrective attendance). Cost D is the total: A + B + C.',
      },
      {
        q: 'What does Cost A cover?',
        a: 'Cost A is the annual price for two full PPM-A service visits per year. It includes labour, consumables (oil, filters, belts), accommodation, and transport — but excludes spare parts, which are priced separately from the spare parts catalogue.',
      },
      {
        q: 'What does Cost B cover?',
        a: 'Cost B is the annual price for two technical inspection (PPM-B) visits per year. It covers labour, accommodation, and transport for inspection-only visits. No consumables or spare parts are included.',
      },
      {
        q: 'What does Cost C cover?',
        a: 'Cost C is an annual flat fee for unlimited corrective and emergency attendance. The client pays this once and can call out the vendor as many times as needed for reactive maintenance throughout the year.',
      },
      {
        q: 'Are spare parts included in any cost?',
        a: 'No. Spare parts are always additional and priced from the agreed spare parts catalogue (KVA-range pricing matrix). The KVA Pricing Matrix tab in Settings shows per-part pricing for each generator size.',
      },
    ],
  },
  {
    title: 'Work Orders & Route Planning',
    icon: '🔧',
    items: [
      {
        q: 'What is a Work Order?',
        a: 'A Work Order groups one or more site visits into a single job assigned to a service provider. It has a status flow: Draft → Assigned → En Route → Pre-Inspection → In Progress → Completed → Signed Off.',
      },
      {
        q: 'What is a Route Stop?',
        a: 'Each site visit within a Work Order is a Route Stop. Stops are sequenced by the Route Planner using nearest-neighbour optimisation to minimise travel distance. Each stop tracks arrival time, technician notes, and completion status.',
      },
      {
        q: 'What is a Pre-Inspection?',
        a: 'Before starting corrective work that needs spare parts, the technician submits a Pre-Inspection listing the parts required with estimated costs. The client reviews and approves or rejects it before work proceeds. This prevents unauthorised spend.',
      },
      {
        q: 'How does the Route Planner work?',
        a: 'Select assets, set a start point, and the planner uses the Haversine formula (straight-line distance) to find the shortest visit sequence. Drive time estimates assume 60 km/h average. The result can be saved directly as a Work Order.',
      },
    ],
  },
  {
    title: 'SLA & Penalties',
    icon: '📋',
    items: [
      {
        q: 'What is an SLA in this context?',
        a: 'SLA (Service Level Agreement) defines how quickly the vendor must respond to and resolve faults. Each quarter, assets are graded: Exceptional, Very Good, Marginal, Unsatisfactory, or Defective — based on response/resolution times and any penalty events.',
      },
      {
        q: 'How are penalty percentages calculated?',
        a: 'Each SLA breach event carries a penalty percentage (typically 5% or 10%). These accumulate per asset per quarter. The penalty amount is applied against the contract value for that asset. Defective service can attract up to 100% penalty on the affected period.',
      },
      {
        q: 'What triggers an SLA event?',
        a: 'Common triggers: missed response time, missed scheduled visit, incomplete service report, generator left in fault state, and repeated failures within a quarter. Each event is logged with type, date, penalty %, and whether it was resolved.',
      },
      {
        q: 'What is the difference between response time and resolution time?',
        a: 'Response time is how long it takes for a technician to arrive on site after a callout. Resolution time is how long until the generator is returned to operational status. Both are tracked and graded against contract thresholds.',
      },
    ],
  },
  {
    title: 'Assets & Status',
    icon: '⚡',
    items: [
      {
        q: 'What does KVA mean?',
        a: 'KVA (kilovolt-ampere) is the apparent power rating of a generator. It indicates the maximum electrical load it can supply. Common sizes in this contract range from 22–35 KVA (small office) to 250–330 KVA (large facility). KVA determines spare parts pricing.',
      },
      {
        q: 'What are the asset operational statuses?',
        a: (
          <div className="space-y-1.5 mt-1">
            {[
              { s: 'Operational', c: 'bg-green-100 text-green-700', d: 'Running normally — no active faults.' },
              { s: 'Under Maintenance', c: 'bg-blue-100 text-blue-700', d: 'Currently being serviced or repaired.' },
              { s: 'Fault', c: 'bg-red-100 text-red-700', d: 'Has a reported fault — SLA clock may be running.' },
              { s: 'Standby', c: 'bg-yellow-100 text-yellow-700', d: 'Functional but not in active use.' },
              { s: 'Decommissioned', c: 'bg-gray-100 text-gray-500', d: 'Removed from service.' },
            ].map(r => (
              <div key={r.s} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${r.c}`}>{r.s}</span>
                <span className="text-xs text-gray-600">{r.d}</span>
              </div>
            ))}
          </div>
        ),
      },
      {
        q: 'What is the service frequency?',
        a: 'Service frequency defines how often scheduled maintenance visits are generated for an asset: Monthly, Quarterly (every 3 months), Biannual (twice a year — PPM-A and PPM-B), or Annual. Most genset framework contracts use Biannual.',
      },
    ],
  },
  {
    title: 'Service Providers & Vendors',
    icon: '👷',
    items: [
      {
        q: 'How does vendor onboarding work?',
        a: 'Admins invite a service provider by email. The SP receives a link to the portal where they upload their ID, selfie, CV, and certificates, set their GPS location, and select the sites they can cover. After review, the admin approves them and a contractor badge PDF is generated.',
      },
      {
        q: 'What is the Contractor Badge?',
        a: 'A CR80 (credit-card sized) PDF ID card showing the SP\'s photo, name, company, authorised sites, contract validity, and a QR code. Scanning the QR opens the public verification page showing identity, active work orders, and authorised sites.',
      },
      {
        q: 'What sites can a vendor cover?',
        a: 'Each vendor\'s profile lists the specific site codes they are authorised to service. Admins and the vendor themselves can update this. Only authorised vendors should be assigned Work Orders for a given site.',
      },
    ],
  },
]

// ── Components ────────────────────────────────────────────────────────────────

function AccordionItem({ q, a }: FaqItem) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
      >
        <span className="text-sm font-medium text-gray-800 pr-4">{q}</span>
        <span className="text-gray-400 shrink-0 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-50">
          <div className="pt-3">{a}</div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FrameworkFaqPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Help & Glossary</h1>
        <p className="text-sm text-gray-500 mt-1">
          Understand service types, scheduling, pricing, SLA, and how this contract space works.
        </p>
      </div>

      {/* Service Types — always expanded */}
      <section>
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
          Service Types Explained
        </h2>
        <div className="grid grid-cols-1 gap-3">
          {SERVICE_TYPES.map(st => (
            <div key={st.code} className={`rounded-xl border p-4 ${st.color}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.badge}`}>
                      {st.label}
                    </span>
                    <span className="text-xs font-semibold">{st.full}</span>
                    <span className="text-xs opacity-60 ml-auto">{st.frequency}</span>
                  </div>
                  <p className="text-xs mt-2 leading-relaxed opacity-80">{st.description}</p>
                  <p className="text-[10px] mt-1.5 font-medium opacity-60">Pricing: {st.cost}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PPM Scheduling explanation */}
      <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📅</span>
          <div>
            <h2 className="text-sm font-bold text-amber-900">What is PPM Scheduling?</h2>
            <p className="text-xs text-amber-800 leading-relaxed mt-1.5">
              <strong>PPM (Planned Preventive Maintenance)</strong> is a proactive strategy where equipment is
              serviced at fixed intervals <em>before</em> it fails — rather than waiting for a breakdown.
            </p>
            <p className="text-xs text-amber-800 leading-relaxed mt-2">
              In this contract, each generator asset has a scheduled maintenance calendar. The system
              automatically tracks upcoming visits, flags overdue schedules, and links each visit to a
              Work Order assigned to the service provider. Completing PPM on time keeps SLA scores high
              and avoids penalty deductions.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: 'Biannual contract', detail: 'PPM-A + PPM-B = 4 visits/year per site' },
                { label: 'Quarterly contract', detail: '4 quarterly checks/year per site' },
                { label: 'SLA tied to PPM', detail: 'Missed scheduled visits = SLA event' },
                { label: 'Work Order grouping', detail: 'Multiple sites batched into one routed job' },
              ].map(item => (
                <div key={item.label} className="bg-white rounded-lg p-2.5 border border-amber-100">
                  <div className="font-semibold text-amber-800">{item.label}</div>
                  <div className="text-amber-600 mt-0.5">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Sections */}
      <section>
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
          Frequently Asked Questions
        </h2>
        <div className="space-y-6">
          {FAQ_SECTIONS.map(section => (
            <div key={section.title}>
              <button
                onClick={() => setActiveSection(prev => prev === section.title ? null : section.title)}
                className="flex items-center gap-2 mb-2 w-full text-left group"
              >
                <span className="text-base">{section.icon}</span>
                <span className="text-sm font-semibold text-gray-800 group-hover:text-amber-700 transition">
                  {section.title}
                </span>
                <span className="text-gray-300 text-xs ml-auto">
                  {activeSection === section.title ? '▲' : '▼'}
                </span>
              </button>
              {(activeSection === section.title || activeSection === null) && (
                <div className="space-y-2">
                  {section.items.map(item => (
                    <AccordionItem key={item.q} {...item} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Quick Reference */}
      <section className="bg-gray-50 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-3">Quick Reference</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-semibold text-gray-500">Term</th>
                <th className="text-left py-2 font-semibold text-gray-500">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['PPM',       'Planned Preventive Maintenance — scheduled before failure'],
                ['KVA',       'Kilovolt-ampere — generator power rating (22–330 KVA in this contract)'],
                ['Schedule 4','Contract pricing table: Cost A + B + C = D per site per year'],
                ['Cost A',    '2 full PPM-A service visits/year (labour + consumables)'],
                ['Cost B',    '2 PPM-B technical inspection visits/year'],
                ['Cost C',    'Annual unlimited corrective + emergency attendance flat fee'],
                ['Cost D',    'Total annual cost per site: A + B + C'],
                ['SLA',       'Service Level Agreement — response/resolution time commitments'],
                ['Work Order','A grouped job assigning multiple site visits to a vendor'],
                ['Route Stop','A single site visit within a Work Order'],
                ['Pre-Inspection','Parts approval step before corrective work begins'],
                ['CR80 Badge','Credit-card sized contractor ID badge (85.6 × 54 mm)'],
                ['OTP',       'One-Time Password — used for vendor portal login'],
              ].map(([term, meaning]) => (
                <tr key={term}>
                  <td className="py-2 pr-4 font-semibold text-gray-700 whitespace-nowrap">{term}</td>
                  <td className="py-2 text-gray-600">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
