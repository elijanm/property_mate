import { Link } from 'react-router-dom'
import PublicShell from '@/layouts/PublicShell'

const BLUE = '#1D4ED8'

const TEAM = [
  { name: 'Amara Osei', role: 'Co-founder & CEO', bio: 'Former property manager with 12 years experience across Kenya and Uganda. Built FahariCloud after spending too many weekends fixing broken spreadsheets.' },
  { name: 'David Kimani', role: 'Co-founder & CTO', bio: 'Systems engineer. Previously built payment infrastructure at a tier-1 Kenyan bank. Obsessed with reliability at scale.' },
  { name: 'Wanjiru Njue', role: 'Head of Product', bio: 'Studied how real property managers work before writing a single line of spec. Believes software should fit the workflow, not the other way around.' },
  { name: 'Samuel Odhiambo', role: 'Head of Customer Success', bio: 'Onboarded our first 200 customers himself. Still answers support tickets personally. Our users know him by name.' },
]

const VALUES = [
  {
    title: 'Built for the real world',
    desc: 'Not a US SaaS with a Kenya flag slapped on. Every feature — Mpesa integration, KES billing, local lease law — reflects how property management actually works in East Africa.',
  },
  {
    title: 'Reliability is the product',
    desc: 'Rent collection can\'t go down at end of month. We run on distributed infrastructure, replica databases, and automatic failover so your business never stops.',
  },
  {
    title: 'Transparency over hype',
    desc: 'Our pricing is public. Our data practices are plain-language. We don\'t lock you in or hide fees in fine print. If something breaks, we tell you.',
  },
  {
    title: 'Landlords, agents, and tenants all matter',
    desc: 'We build for every person in the ecosystem. A platform that works for landlords but frustrates tenants isn\'t solving the problem — it\'s shifting it.',
  },
]

export default function AboutPage() {
  return (
    <PublicShell>
      {/* Hero */}
      <div className="border-b border-gray-100 bg-gray-50 py-12">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">About FahariCloud</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
            We built the platform<br />we wished existed.
          </h1>
          <p className="mt-4 text-base text-gray-500 leading-relaxed max-w-xl mx-auto">
            FahariCloud started in Nairobi in 2022 when our founders — a property manager and a software engineer —
            realised that East African landlords deserved software built for them, not adapted from somewhere else.
          </p>
        </div>
      </div>

      {/* Story */}
      <div className="py-12 border-b border-gray-100">
        <div className="mx-auto max-w-3xl px-5">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-3">The problem</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Property management in East Africa runs on WhatsApp group chats, Excel files shared over email,
                and manual Mpesa reconciliation done by hand every end of month. Landlords with 20 units spend
                entire weekends on admin. Agencies with 200 units employ full-time "Excel operators."
              </p>
              <p className="text-sm text-gray-500 leading-relaxed mt-3">
                The global property management software options either didn't integrate with Mpesa, assumed USD
                billing, or were so generic they required months of configuration to do anything useful.
              </p>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-3">The solution</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                FahariCloud is purpose-built for East Africa — Mpesa C2B reconciliation, KES/UGX/TZS billing,
                digital lease signing, and a tenant self-service portal that actually gets used. We also built
                for scale: multi-property portfolios, agent management, IoT meter reading, and automated billing
                cycles.
              </p>
              <p className="text-sm text-gray-500 leading-relaxed mt-3">
                Today, FahariCloud manages thousands of units across Kenya, Uganda, Tanzania, Rwanda, and Ethiopia.
                Our global variant, SparcCloud, extends the same platform to portfolios worldwide.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Values */}
      <div className="py-12 border-b border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-xl font-bold text-gray-900 mb-8">What we stand for</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(v => (
              <div key={v.title} className="rounded-lg border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-bold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-[13px] text-gray-500 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team */}
      <div className="py-12 border-b border-gray-100">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-xl font-bold text-gray-900 mb-2">The team</h2>
          <p className="text-sm text-gray-500 mb-8">A small, focused team that ships and supports.</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM.map(member => (
              <div key={member.name} className="rounded-lg border border-gray-200 p-5">
                <div
                  className="h-12 w-12 rounded-full flex items-center justify-center text-white text-lg font-bold mb-4"
                  style={{ backgroundColor: BLUE }}
                >
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <p className="text-sm font-bold text-gray-900">{member.name}</p>
                <p className="text-[11px] text-blue-600 font-semibold mt-0.5 mb-2">{member.role}</p>
                <p className="text-[12px] text-gray-500 leading-relaxed">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-gray-900 py-10">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
            {[
              { n: '2022', l: 'Founded', s: 'Nairobi, Kenya' },
              { n: '6+',   l: 'Countries', s: 'KE · UG · TZ · RW · ET · +' },
              { n: '10k+', l: 'Units managed', s: 'And growing' },
              { n: '24/7', l: 'Support',  s: 'WhatsApp + email' },
            ].map(s => (
              <div key={s.l}>
                <p className="text-3xl font-black text-white">{s.n}</p>
                <p className="mt-1.5 text-sm font-semibold text-gray-300">{s.l}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.s}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-10 border-t border-gray-100">
        <div className="mx-auto max-w-xl px-5 text-center">
          <h2 className="text-xl font-bold text-gray-900">Want to join us?</h2>
          <p className="mt-2 text-sm text-gray-500">We hire people who care about building things that actually work for real people.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link to="/careers"
              className="rounded-md px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
              style={{ backgroundColor: BLUE }}>
              See open roles
            </Link>
            <a href="mailto:hello@faharicloud.com"
               className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
              Get in touch
            </a>
          </div>
        </div>
      </div>
    </PublicShell>
  )
}
