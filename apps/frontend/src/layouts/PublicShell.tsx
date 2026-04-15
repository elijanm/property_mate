/**
 * PublicShell — shared nav + footer wrapper used by all public marketing pages.
 * LandingPage has its own inline nav/footer; all other public pages use this.
 */

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const BLUE = '#1D4ED8'

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'Portals',  href: '/#portals'  },
  { label: 'Pricing',  href: '/pricing'   },
  { label: 'Blog',     href: '/blog'      },
]

const FOOTER_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features',    to: '/#features' },
      { label: 'Portals',     to: '/#portals'  },
      { label: 'Pricing',     to: '/pricing'   },
      { label: "What's new",  to: '/changelog' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About',    to: '/about'   },
      { label: 'Blog',     to: '/blog'    },
      { label: 'Careers',  to: '/careers' },
      { label: 'Privacy',  to: '/privacy' },
    ],
  },
  {
    heading: 'Contact',
    links: [
      { label: 'hello@faharicloud.com', to: 'mailto:hello@faharicloud.com' },
      { label: 'WhatsApp support',      to: 'https://wa.me/254700000000'  },
      { label: 'Nairobi, Kenya',        to: '#'                           },
    ],
  },
]

function PublicNav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white border-b border-gray-200">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: BLUE }}>
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-[15px] font-bold text-gray-900 tracking-tight">FahariCloud</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 md:flex">
          {NAV_LINKS.map(l => (
            <Link
              key={l.label}
              to={l.href}
              className={`transition-colors hover:text-gray-900 ${pathname === l.href ? 'text-blue-700 font-semibold' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">Log in</Link>
          <Link
            to="/signup"
            className="rounded-md px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: BLUE }}
          >
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
          {NAV_LINKS.map(l => (
            <Link key={l.label} to={l.href} className="block py-2 text-sm font-medium text-gray-700" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
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

function PublicFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
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
              Property management built for East Africa. Mpesa-native, lease-ready, and built to scale from one unit to thousands.
            </p>
            <p className="mt-2 text-[11px] text-gray-400">Also available as SparcCloud globally.</p>
          </div>

          {FOOTER_COLS.map(col => (
            <div key={col.heading}>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-500">{col.heading}</p>
              <ul className="space-y-2">
                {col.links.map(l => (
                  <li key={l.label}>
                    {l.to.startsWith('mailto:') || l.to.startsWith('https://') ? (
                      <a href={l.to} className="text-[12px] text-gray-500 hover:text-gray-900 transition" target="_blank" rel="noopener noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.to} className="text-[12px] text-gray-500 hover:text-gray-900 transition">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
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

interface Props { children: React.ReactNode }

export default function PublicShell({ children }: Props) {
  return (
    <div className="antialiased bg-white">
      <PublicNav />
      <main className="pt-14">{children}</main>
      <PublicFooter />
    </div>
  )
}
