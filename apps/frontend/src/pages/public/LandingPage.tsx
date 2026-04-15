/**
 * FahariCloud landing page
 * Brand: FahariCloud (East Africa) | SparcCloud (global)
 * Design: Clean light SaaS — white/light-gray, single blue accent, compact.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'

// ─── Shared primitives ────────────────────────────────────────────────────────

const BLUE = '#1D4ED8'   // single brand blue — used everywhere

function Chevron({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function Check({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white border-b border-gray-200">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: BLUE }}>
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-[15px] font-bold text-gray-900 tracking-tight">FahariCloud</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 md:flex">
          <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
          <a href="#portals"  className="hover:text-gray-900 transition-colors">Portals</a>
          <Link to="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
          <Link to="/blog"    className="hover:text-gray-900 transition-colors">Blog</Link>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">Log in</Link>
          <Link to="/signup"
            className="rounded-md px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: BLUE }}>
            Start free trial
          </Link>
        </div>

        <button className="text-gray-500 md:hidden" onClick={() => setOpen(v => !v)}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={open ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-100 bg-white px-5 py-3 md:hidden">
          <a href="#features" className="block py-2 text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Features</a>
          <a href="#portals"  className="block py-2 text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Portals</a>
          <Link to="/pricing" className="block py-2 text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Pricing</Link>
          <Link to="/blog"    className="block py-2 text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>Blog</Link>
          <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-3">
            <Link to="/login" className="text-sm text-gray-600">Log in</Link>
            <Link to="/signup" className="rounded-md py-2 text-center text-sm font-semibold text-white" style={{ backgroundColor: BLUE }}>
              Start free trial
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Accurate system screen mock ──────────────────────────────────────────────

function PropertiesMock() {
  const rows = [
    { name: 'Westlands Heights', city: 'Westlands, Nairobi', type: 'Residential', units: 48, occ: '94%', col: '#1D4ED8' },
    { name: 'Karen Business Park', city: 'Karen, Nairobi', type: 'Commercial', units: 24, occ: '88%', col: '#0891B2' },
    { name: 'Kileleshwa Court', city: 'Kileleshwa, Nairobi', type: 'Residential', units: 60, occ: '97%', col: '#059669' },
  ]

  return (
    <div className="flex h-full bg-gray-50 text-[11px] select-none overflow-hidden">
      {/* Sidebar */}
      <aside className="w-44 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: BLUE }}>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-bold text-gray-900">FahariCloud</span>
          </div>
          <p className="text-[9px] text-gray-400 mt-1 font-medium uppercase tracking-wider">Owner</p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {[
            { label: 'Dashboard', icon: '◫', active: false },
            { label: 'Properties', icon: '🏢', active: true  },
            { label: 'Tenants',   icon: '👥', active: false },
            { label: 'Finances',  icon: '💳', active: false },
            { label: 'Tickets',   icon: '🔧', active: false },
            { label: 'Reports',   icon: '📊', active: false },
            { label: 'Settings',  icon: '⚙',  active: false },
          ].map(n => (
            <div key={n.label}
                 className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium cursor-pointer
                   ${n.active ? 'text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                 style={n.active ? { backgroundColor: BLUE } : {}}>
              <span className="text-xs w-3.5 text-center">{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center text-[8px] font-bold text-blue-700">JM</div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-800 truncate text-[10px]">James Mutua</p>
              <p className="text-gray-400 text-[8px]">james@realty.co.ke</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-sm font-bold text-gray-900">Properties</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">3 properties · 132 units · KES 2.4M collected</p>
          </div>
          <button className="px-3 py-1.5 rounded-md text-[10px] font-semibold text-white" style={{ backgroundColor: BLUE }}>
            + New Property
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { l: 'Occupied', v: '124', tag: 'of 132', c: 'text-green-700', bg: 'bg-green-50 border-green-100' },
            { l: 'Vacant',   v: '8',   tag: 'units',  c: 'text-red-600',  bg: 'bg-red-50 border-red-100' },
            { l: 'Collected',v: 'KES 2.4M', tag: 'Jan 2025', c: 'text-blue-700', bg: 'bg-blue-50 border-blue-100' },
          ].map(s => (
            <div key={s.l} className={`rounded-lg border px-3 py-2 ${s.bg}`}>
              <p className={`text-sm font-bold ${s.c}`}>{s.v}</p>
              <p className="text-[9px] text-gray-500 mt-0.5">{s.l} · {s.tag}</p>
            </div>
          ))}
        </div>

        {/* Property list */}
        <div className="space-y-2">
          {rows.map(p => (
            <div key={p.name} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:border-gray-300 transition cursor-pointer">
              <div className="h-0.5" style={{ backgroundColor: p.col }} />
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: p.col }}>
                  {p.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                  <p className="text-[9px] text-gray-400">{p.city}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">{p.type}</span>
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">{p.units} units</span>
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-medium text-green-700">{p.occ} occ.</span>
                  <Chevron className="w-3 h-3 text-gray-300" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

// ─── Hero (two-column: copy left, screenshot right) ───────────────────────────

const REVIEW_STARS = Array(5).fill('★').join('')

function Hero() {
  return (
    <section className="bg-white pt-20 pb-12">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-16">

          {/* Left — copy */}
          <div className="flex-1 max-w-xl">
            {/* Review trust badge */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-1 border border-gray-200 rounded px-2 py-1 text-[10px] font-semibold text-gray-600 -ml-px first:ml-0 bg-white">
                    <span className="text-yellow-400 text-xs">{REVIEW_STARS}</span>
                    <span>4.8</span>
                  </div>
                ))}
              </div>
              <span className="text-[11px] text-gray-400">2,400+ property managers</span>
            </div>

            <h1 className="text-4xl font-bold leading-tight tracking-tight text-gray-900 sm:text-[44px]">
              The all-in-one platform<br />
              that scales with<br />
              your portfolio.
            </h1>

            <p className="mt-4 text-base text-gray-500 leading-relaxed">
              FahariCloud combines rent collection, digital leases, utility billing,
              maintenance, and financial reporting in one place — built for East African
              landlords and property managers.
            </p>

            <div className="mt-6 flex flex-wrap gap-y-2.5 gap-x-5">
              {[
                'No spreadsheets needed',
                'Mpesa-native payments',
                'Free to get started',
              ].map(t => (
                <div key={t} className="flex items-center gap-1.5 text-sm text-gray-600">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: '#DBEAFE' }}>
                    <Check className="w-2.5 h-2.5 text-blue-700" />
                  </div>
                  {t}
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/signup"
                className="rounded-md px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 shadow-sm"
                style={{ backgroundColor: BLUE }}>
                Start free trial
              </Link>
              <a href="#features"
                 className="flex items-center gap-1.5 rounded-md border border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                See all features
                <Chevron className="w-3.5 h-3.5" />
              </a>
            </div>

            <p className="mt-3 text-xs text-gray-400">No credit card required · Cancel anytime</p>
          </div>

          {/* Right — system screenshot */}
          <div className="flex-1 lg:max-w-[560px]">
            <div className="rounded-lg border border-gray-200 shadow-xl overflow-hidden">
              {/* Browser bar */}
              <div className="flex items-center gap-1.5 bg-gray-100 border-b border-gray-200 px-3 py-2">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                <div className="ml-3 flex-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-400">
                  app.faharicloud.com/properties
                </div>
              </div>
              <div className="h-[360px]">
                <PropertiesMock />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Logos bar ────────────────────────────────────────────────────────────────

function LogosBar() {
  return (
    <div className="border-y border-gray-100 bg-gray-50 py-5">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Trusted by managers across East Africa
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-1">
            {['Nairobi', 'Mombasa', 'Kisumu', 'Kampala', 'Dar es Salaam', 'Kigali'].map(c => (
              <span key={c} className="text-sm font-semibold text-gray-400">{c}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Features 4-col grid ─────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: '💳',
    title: 'Rent collection & reconciliation',
    desc: 'Mpesa C2B payments reconciled automatically. Track every collection, flag arrears, and send reminders — no manual matching.',
  },
  {
    icon: '📋',
    title: 'Digital lease management',
    desc: 'Draft leases, collect deposits via Mpesa, send for e-signature, and store signed PDFs — all in one guided flow.',
  },
  {
    icon: '⚡',
    title: 'Utility billing',
    desc: 'Shared charges or IoT meter readings flow directly into monthly invoices, calculated per tariff tier automatically.',
  },
  {
    icon: '🔧',
    title: 'Maintenance & ticketing',
    desc: 'Tenants raise tickets, vendors get assigned, SLAs are tracked, and service providers are paid on completion.',
  },
  {
    icon: '📊',
    title: 'Financial reports',
    desc: 'Rent roll, arrears aging, collection-rate trends, payment scorecards, and vacancy loss — all generated in seconds.',
  },
  {
    icon: '👥',
    title: 'Tenant onboarding',
    desc: 'ID verification, lease signing, and deposit payment in one digital wizard. No visits, no printing, no back-and-forth.',
  },
  {
    icon: '🏢',
    title: 'Portfolio management',
    desc: 'Manage multiple properties and property types from a single dashboard. Assign agents, track commissions, and review performance.',
  },
  {
    icon: '📱',
    title: 'AI voice agent',
    desc: 'Tenants call your property line. The AI handles balance queries, payment links, and ticket creation — 24/7, no staff needed.',
  },
]

function FeaturesSection() {
  return (
    <section id="features" className="bg-white py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Features</p>
            <h2 className="mt-1.5 text-2xl font-bold text-gray-900 sm:text-3xl">
              Everything your portfolio needs
            </h2>
          </div>
          <Link to="/signup" className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0">
            See all features <Chevron className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md hover:border-gray-300 transition-all">
              <div className="mb-3 text-2xl">{f.icon}</div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-[13px] text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Split feature — Command Center ──────────────────────────────────────────

function CommandMock() {
  const metrics = [
    { label: 'Occupancy', value: '94.2%', prev: '+2.1%', bar: 94, good: true },
    { label: 'Collection rate', value: '88.7%', prev: '+5.4%', bar: 89, good: true },
    { label: 'Open tickets', value: '12', prev: '3 past SLA', bar: 40, good: false },
    { label: 'Arrears', value: 'KES 182K', prev: '↓ 12% vs last month', bar: 25, good: false },
  ]

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden text-[11px] select-none">
      <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Portfolio — January 2025</p>
          <p className="font-bold text-gray-900 mt-0.5">Command Center</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-green-600">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Live
        </div>
      </div>

      <div className="p-4">
        {/* Mini chart */}
        <div className="mb-4 rounded-md border border-gray-100 bg-gray-50 p-3">
          <p className="text-[9px] text-gray-400 font-medium mb-2">Collection rate · 12 months</p>
          <div className="flex h-12 items-end gap-1">
            {[64, 70, 74, 69, 77, 80, 75, 82, 85, 88, 90, 89].map((v, i) => (
              <div key={i} className="flex-1 rounded-sm"
                   style={{ height: `${v}%`, backgroundColor: i === 11 ? BLUE : '#E5E7EB' }} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {['Feb', '', '', 'May', '', '', 'Aug', '', '', 'Nov', '', 'Jan'].map((m, i) => (
              <span key={i} className="text-[8px] text-gray-400">{m}</span>
            ))}
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-2">
          {metrics.map(m => (
            <div key={m.label} className="rounded-md border border-gray-100 bg-gray-50 p-3">
              <p className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">{m.label}</p>
              <p className="text-base font-bold text-gray-900 mt-1">{m.value}</p>
              <div className="my-1.5 h-1 rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${m.bar}%`, backgroundColor: m.good ? BLUE : '#F87171' }} />
              </div>
              <p className={`text-[9px] font-semibold ${m.good ? 'text-green-600' : 'text-red-500'}`}>{m.prev}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CommandSection() {
  return (
    <section className="bg-gray-50 py-14 border-y border-gray-100">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col items-center gap-12 lg:flex-row">
          {/* Mock */}
          <div className="w-full lg:w-[480px] shrink-0">
            <CommandMock />
          </div>

          {/* Copy */}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Command Center</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl leading-snug">
              One view across your<br />entire portfolio — live.
            </h2>
            <p className="mt-3 text-[14px] text-gray-500 leading-relaxed">
              Stop finding out about problems when tenants call. FahariCloud surfaces
              arrears, maintenance backlogs, and expiring leases before they become
              expensive surprises.
            </p>

            <ul className="mt-6 space-y-3.5">
              {[
                ['Real-time collection status', 'See paid, pending, and overdue per unit as payments arrive.'],
                ['Arrears aging analysis', 'Know exactly how long each outstanding balance has been open.'],
                ['Maintenance SLA visibility', 'Days elapsed per ticket — spot bottlenecks before escalation.'],
                ['Lease renewal pipeline', 'Leases expiring in 30, 60, 90 days — never miss a renewal window.'],
                ['Utility billing progress', 'Track reading capture and invoice generation per billing cycle.'],
              ].map(([title, desc]) => (
                <li key={title as string} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: '#DBEAFE' }}>
                    <Check className="w-3 h-3 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900">{title}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>

            <Link to="/signup"
              className="mt-7 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: BLUE }}>
              Get your dashboard
              <Chevron className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Portals 4-col ────────────────────────────────────────────────────────────

const PORTALS = [
  {
    emoji: '🏢',
    role: 'Owner',
    tagline: 'Full portfolio command',
    desc: 'Every property, every shilling, every tenant — one view. Automated billing, agent management, and financial reports without hiring an accountant.',
    features: ['Live portfolio dashboard', 'Automated rent invoicing', 'Financial reports & rent roll', 'Mpesa B2C settlement payouts'],
  },
  {
    emoji: '🤝',
    role: 'Agent',
    tagline: 'Manage your assignments',
    desc: 'Lease renewals, tenant communication, rent collection, and maintenance triage for your assigned properties.',
    features: ['Assigned property workspace', 'Tenant move-in & move-out', 'Lease renewal management', 'Commission tracking'],
  },
  {
    emoji: '🏠',
    role: 'Tenant',
    tagline: 'Self-service, any time',
    desc: 'View lease, pay rent with one Mpesa tap, review utility bills, and raise maintenance requests without calling anyone.',
    features: ['View lease & invoice history', 'One-tap Mpesa payment', 'Utility statement breakdown', 'Submit & track tickets'],
  },
  {
    emoji: '🔧',
    role: 'Service Provider',
    tagline: 'Jobs to payout, tracked',
    desc: 'View work orders, update progress, upload evidence, and receive payment on job completion — no back-and-forth.',
    features: ['Work order queue', 'Photo evidence upload', 'Real-time status updates', 'Automated payout on completion'],
  },
]

function PortalsSection() {
  return (
    <section id="portals" className="bg-white py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Portals</p>
          <h2 className="mt-1.5 text-2xl font-bold text-gray-900 sm:text-3xl">
            Built for every person in your ecosystem
          </h2>
          <p className="mt-2 text-[14px] text-gray-500 max-w-xl">
            Each stakeholder gets a purpose-built interface — the right access, the right tools, nothing extra.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PORTALS.map(p => (
            <div key={p.role} className="rounded-lg border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all">
              <div className="text-2xl mb-3">{p.emoji}</div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: BLUE }}>{p.role}</p>
              <h3 className="text-sm font-bold text-gray-900 mb-2">{p.tagline}</h3>
              <p className="text-[12px] text-gray-500 leading-relaxed mb-4">{p.desc}</p>
              <ul className="space-y-1.5">
                {p.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-[12px] text-gray-600">
                    <div className="h-1 w-1 rounded-full shrink-0 bg-gray-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

function StatsSection() {
  return (
    <section className="border-y border-gray-200 bg-gray-900 py-12">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
          {[
            { n: '4',    l: 'Stakeholder portals',   s: 'Owner · Agent · Tenant · Vendor'  },
            { n: '15h',  l: 'Saved per week',         s: 'vs. spreadsheet workflows'        },
            { n: '100%', l: 'Mpesa-native',           s: 'C2B reconciliation & B2C payouts' },
            { n: '<30s', l: 'Per billing cycle',      s: 'Full invoice generation run'      },
          ].map(s => (
            <div key={s.l}>
              <p className="text-4xl font-black tracking-tight text-white">{s.n}</p>
              <p className="mt-2 text-sm font-semibold text-gray-300">{s.l}</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.s}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Global reach ─────────────────────────────────────────────────────────────

function GlobalSection() {
  return (
    <section className="bg-gray-50 border-b border-gray-100 py-12">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-16">
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Global reach</p>
            <h2 className="mt-1.5 text-2xl font-bold text-gray-900 sm:text-3xl">East Africa. And beyond.</h2>
            <p className="mt-3 text-[14px] text-gray-500 leading-relaxed max-w-lg">
              <strong className="text-gray-800">FahariCloud</strong> is purpose-built for East Africa — Mpesa-native,
              KES/UGX/TZS billing, and aligned with local lease law in Kenya, Uganda, Tanzania, Rwanda, and Ethiopia.
            </p>
            <p className="mt-2 text-[14px] text-gray-500 leading-relaxed max-w-lg">
              Managing properties internationally? <strong className="text-gray-800">SparcCloud</strong> brings the same
              platform globally — multi-currency, any payment rail, any language.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5 text-center min-w-[160px]">
              <p className="text-lg font-black text-blue-800">FahariCloud</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-blue-500">East Africa</p>
              <p className="mt-2 text-[11px] text-blue-700">KE · UG · TZ · RW · ET</p>
            </div>
            <div className="rounded-lg border-2 border-gray-200 bg-white p-5 text-center min-w-[160px]">
              <p className="text-lg font-black text-gray-800">SparcCloud</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Worldwide</p>
              <p className="mt-2 text-[11px] text-gray-500">Multi-currency · Any rail</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

const TESTIMONIALS = [
  {
    quote: "We cut invoice generation from 3 days to under an hour. FahariCloud handles the billing, we handle the relationships.",
    name: 'Grace Njoroge',
    role: 'Portfolio Manager · Nairobi',
    stars: 5,
  },
  {
    quote: "Our tenants used to call about balances constantly. Now they check the portal. Support calls dropped by half.",
    name: 'Brian Ochieng',
    role: 'Property Owner · Kisumu',
    stars: 5,
  },
  {
    quote: "Moving from spreadsheets was easier than I expected. The Mpesa integration alone was worth it.",
    name: 'Fatuma Hassan',
    role: 'Landlord · Mombasa',
    stars: 5,
  },
]

function TestimonialsSection() {
  return (
    <section className="bg-white py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">What customers say</p>
          <h2 className="mt-1.5 text-2xl font-bold text-gray-900 sm:text-3xl">Trusted by property managers across East Africa</h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow">
              <div className="mb-3 flex">
                {[...Array(t.stars)].map((_, i) => (
                  <svg key={i} className="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed italic mb-4">&ldquo;{t.quote}&rdquo;</p>
              <div>
                <p className="text-[12px] font-semibold text-gray-900">{t.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="bg-gray-900 py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Start managing your portfolio today.
            </h2>
            <p className="mt-2 text-[14px] text-gray-400 max-w-lg">
              Join property managers across East Africa who replaced spreadsheets with FahariCloud.
              Setup takes minutes. No credit card required.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/signup"
              className="rounded-md px-6 py-3 text-sm font-bold text-white transition hover:opacity-90 whitespace-nowrap"
              style={{ backgroundColor: BLUE }}>
              Start free trial
            </Link>
            <Link to="/login"
              className="rounded-md border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition whitespace-nowrap">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-3">
              <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ backgroundColor: BLUE }}>
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="font-bold text-gray-900">FahariCloud</span>
            </Link>
            <p className="text-[12px] text-gray-500 leading-relaxed max-w-xs">
              Property management built for East Africa. Mpesa-native, lease-ready, and
              built to scale from one unit to thousands.
            </p>
            <p className="mt-2 text-[11px] text-gray-400">Also available as SparcCloud globally.</p>
          </div>

          {/* Product links */}
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-500">Product</p>
            <ul className="space-y-2">
              <li><a href="#features" className="text-[12px] text-gray-500 hover:text-gray-900 transition">Features</a></li>
              <li><a href="#portals"  className="text-[12px] text-gray-500 hover:text-gray-900 transition">Portals</a></li>
              <li><Link to="/pricing"   className="text-[12px] text-gray-500 hover:text-gray-900 transition">Pricing</Link></li>
              <li><Link to="/changelog" className="text-[12px] text-gray-500 hover:text-gray-900 transition">What&apos;s new</Link></li>
            </ul>
          </div>

          {/* Company links */}
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-500">Company</p>
            <ul className="space-y-2">
              <li><Link to="/about"   className="text-[12px] text-gray-500 hover:text-gray-900 transition">About</Link></li>
              <li><Link to="/blog"    className="text-[12px] text-gray-500 hover:text-gray-900 transition">Blog</Link></li>
              <li><Link to="/careers" className="text-[12px] text-gray-500 hover:text-gray-900 transition">Careers</Link></li>
              <li><Link to="/privacy" className="text-[12px] text-gray-500 hover:text-gray-900 transition">Privacy</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-500">Contact</p>
            <ul className="space-y-2">
              <li><a href="mailto:hello@faharicloud.com" className="text-[12px] text-gray-500 hover:text-gray-900 transition">hello@faharicloud.com</a></li>
              <li><a href="https://wa.me/254700000000" target="_blank" rel="noopener noreferrer" className="text-[12px] text-gray-500 hover:text-gray-900 transition">WhatsApp support</a></li>
              <li><span className="text-[12px] text-gray-400">Nairobi, Kenya</span></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-gray-200 pt-6 sm:flex-row">
          <p className="text-[11px] text-gray-400">&copy; {new Date().getFullYear()} Nexidra Limited. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-[11px] text-gray-400 hover:text-gray-700">Privacy</Link>
            <Link to="/terms"   className="text-[11px] text-gray-400 hover:text-gray-700">Terms</Link>
            <span className="text-[11px] text-gray-300">FahariCloud · SparcCloud</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="antialiased bg-white">
      <Navbar />
      <Hero />
      <LogosBar />
      <FeaturesSection />
      <CommandSection />
      <PortalsSection />
      <StatsSection />
      <TestimonialsSection />
      <GlobalSection />
      <CtaSection />
      <Footer />
    </div>
  )
}
