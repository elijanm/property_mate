import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { WALLET_ENABLED } from '@/constants/layout'

// ── Wallet mock — replace with real API / hook ──────────────────────────────
const WALLET_BALANCE = 3_250   // KES
const WALLET_LIMIT   = 5_000   // KES

// ── Circular progress ring around avatar ─────────────────────────────────────
function RingAvatar({ initials, progress, size = 40 }: { initials: string; progress: number; size?: number }) {
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circ   = 2 * Math.PI * radius
  const offset = circ * (1 - Math.max(0, Math.min(1, progress)))
  const ringColor = progress > 0.5 ? '#22c55e' : progress > 0.2 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* SVG ring — rotated so 0% starts at top */}
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#e5e7eb" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={ringColor} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      {/* Avatar circle */}
      <div
        className="absolute flex items-center justify-center rounded-full bg-blue-600 text-white font-bold select-none"
        style={{ inset: stroke + 1, fontSize: size * 0.3 }}
      >
        {initials}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserAvatarMenu({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const initials = (user?.email ?? 'U').slice(0, 2).toUpperCase()
  const progress  = WALLET_BALANCE / WALLET_LIMIT
  const pct       = Math.round(progress * 100)

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="focus:outline-none hover:opacity-85 transition-opacity my-1"
        aria-label="User menu"
      >
        <RingAvatar initials={initials} progress={progress} size={36} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">

          {/* ── User identity ─────────────────────────────── */}
          <div className="px-4 py-4 flex items-center gap-3 border-b border-gray-100">
            <RingAvatar initials={initials} progress={progress} size={44} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{user?.email}</p>
              <p className="text-xs text-gray-400 capitalize mt-0.5">
                {user?.role?.replace('_', ' ')}
              </p>
            </div>
          </div>

          {/* ── Wallet card ───────────────────────────────── */}
          {WALLET_ENABLED && (
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl p-4 text-white">
                <p className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Wallet Balance</p>
                <p className="text-2xl font-bold leading-none">
                  KES {WALLET_BALANCE.toLocaleString()}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1 bg-white/25 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] opacity-70 shrink-0">{pct}% of limit</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="flex-1 text-xs bg-white/15 hover:bg-white/25 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
                    Top Up
                  </button>
                  <button className="flex-1 text-xs bg-white/15 hover:bg-white/25 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
                    Transactions
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Actions ───────────────────────────────────── */}
          <div className="px-3 py-2">
            <button
              onClick={() => { setOpen(false); onLogout() }}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <span className="text-base">→</span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
