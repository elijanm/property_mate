import { useState, useEffect } from 'react'
import { X, Cookie } from 'lucide-react'
import clsx from 'clsx'

const STORAGE_KEY = 'mldock_cookie_consent'

type ConsentState = 'accepted' | 'declined' | null

export default function CookieConsent({ onViewPolicy }: { onViewPolicy?: () => void }) {
  const [consent, setConsent] = useState<ConsentState>(null)
  const [visible, setVisible] = useState(false)
  const [detail, setDetail] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ConsentState | null
    if (!saved) {
      // Small delay so it doesn't flash on first paint
      const t = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(t)
    }
    setConsent(saved)
  }, [])

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, 'accepted')
    setConsent('accepted')
    setVisible(false)
  }

  const decline = () => {
    localStorage.setItem(STORAGE_KEY, 'declined')
    setConsent('declined')
    setVisible(false)
  }

  if (!visible || consent !== null) return null

  return (
    <div className={clsx(
      'fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[9999]',
      'bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/60',
      'transition-all duration-300',
    )}>
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cookie size={16} className="text-amber-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-white">Cookie preferences</span>
          </div>
          <button onClick={decline} className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        <p className="text-xs text-gray-400 leading-relaxed">
          We use essential cookies to keep you signed in, and optional analytics cookies to improve the platform.
          {' '}
          {onViewPolicy && (
            <button onClick={onViewPolicy} className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
              Privacy Policy
            </button>
          )}
        </p>

        {/* Detail toggle */}
        <button
          onClick={() => setDetail(v => !v)}
          className="text-[11px] text-gray-600 hover:text-gray-400 underline underline-offset-2 transition-colors"
        >
          {detail ? 'Hide details' : 'Show cookie details'}
        </button>

        {detail && (
          <div className="space-y-2 bg-gray-950 border border-gray-800 rounded-xl p-3">
            {[
              {
                name: 'Essential',
                always: true,
                desc: 'Authentication tokens, session state. Required for the platform to function.',
              },
              {
                name: 'Analytics',
                always: false,
                desc: 'Page view counts and feature usage — no personal data, no third-party trackers.',
              },
            ].map(c => (
              <div key={c.name} className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-gray-300">{c.name}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{c.desc}</div>
                </div>
                <span className={clsx(
                  'flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border',
                  c.always
                    ? 'text-emerald-400 border-emerald-800/50 bg-emerald-900/20'
                    : 'text-gray-500 border-gray-700',
                )}>
                  {c.always ? 'Always on' : 'Optional'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={accept}
            className="flex-1 py-2 text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white rounded-xl transition-colors"
          >
            Accept all
          </button>
          <button
            onClick={decline}
            className="flex-1 py-2 text-xs font-medium border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 rounded-xl transition-colors"
          >
            Essential only
          </button>
        </div>
      </div>
    </div>
  )
}

/** Returns the stored consent value — use to gate analytics calls */
export function getCookieConsent(): ConsentState {
  return localStorage.getItem(STORAGE_KEY) as ConsentState
}
