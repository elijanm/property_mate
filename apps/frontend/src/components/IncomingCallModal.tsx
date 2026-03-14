/**
 * IncomingCallModal — global overlay triggered by WebSocket `incoming_call` events.
 *
 * Renders a persistent, dismissable popup that shows:
 *   - Caller phone number (and matched tenant if known)
 *   - Tenant account balance, unit, and property
 *   - Open tickets that may relate to the call
 *   - Auto-mode badge when the AI is handling the call automatically
 *
 * Mount inside <WebSocketProvider> (App.tsx), after <Routes>.
 */
import { useEffect, useRef, useState } from 'react'
import { useWebSocket } from '@/context/WebSocketContext'
import { useSound } from '@/hooks/useSound'

interface OpenTicket {
  id: string
  title: string
  status: string
  priority: string
  category: string
}

interface CallData {
  call_id: string
  caller_number: string
  tenant_id?: string
  tenant_name?: string
  tenant_email?: string
  unit_label?: string
  property_name?: string
  balance_due?: number
  open_tickets?: OpenTicket[]
  auto_answered?: boolean
  transcript?: string
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-600 bg-red-50',
  high:   'text-orange-600 bg-orange-50',
  normal: 'text-blue-600 bg-blue-50',
  low:    'text-gray-500 bg-gray-100',
}

const STATUS_COLOR: Record<string, string> = {
  open:           'text-gray-700 bg-gray-100',
  assigned:       'text-blue-700 bg-blue-100',
  in_progress:    'text-yellow-700 bg-yellow-100',
  pending_review: 'text-violet-700 bg-violet-100',
  resolved:       'text-green-700 bg-green-100',
}

function RingAnimation() {
  return (
    <div className="relative flex items-center justify-center">
      <span className="absolute inline-flex w-16 h-16 rounded-full bg-green-400 opacity-30 animate-ping" />
      <span className="absolute inline-flex w-12 h-12 rounded-full bg-green-400 opacity-40 animate-ping [animation-delay:0.2s]" />
      <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg">
        <span className="text-2xl">📞</span>
      </div>
    </div>
  )
}

function AutoModeTranscript({ text }: { text: string }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [text])

  return (
    <div className="mt-3 rounded-lg bg-gray-900 p-3 max-h-28 overflow-y-auto font-mono text-xs text-green-400 leading-relaxed">
      <p className="text-gray-500 text-[10px] mb-1 uppercase tracking-wide">Live transcript</p>
      {text || <span className="opacity-60">Connecting…</span>}
      <div ref={endRef} />
    </div>
  )
}

export default function IncomingCallModal() {
  const { subscribe } = useWebSocket()
  const { playCallSound } = useSound()
  const [call, setCall] = useState<CallData | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return subscribe((n) => {
      if (n.type === 'incoming_call') {
        setCall(n.data as CallData)
        setElapsed(0)
        playCallSound()
      }
      // Agent can also push call_updated events for live transcript updates
      if (n.type === 'call_updated') {
        const d = n.data as Partial<CallData>
        setCall((prev) => prev ? { ...prev, ...d } : prev)
      }
      if (n.type === 'call_ended') {
        handleDismiss()
      }
    })
  }, [subscribe])

  // Elapsed timer while call is showing
  useEffect(() => {
    if (!call) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [!!call])

  function handleDismiss() {
    setCall(null)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  if (!call) return null

  const hasMatch = !!call.tenant_name
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const seconds = String(elapsed % 60).padStart(2, '0')

  return (
    <>
      {/* Backdrop — semi-transparent, doesn't block background */}
      <div className="fixed bottom-6 right-6 z-[9999] w-full max-w-sm pointer-events-auto">
        <div className="rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
          {/* Header band */}
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4 flex items-center gap-4">
            <RingAnimation />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold text-sm">Incoming Call</p>
                {call.auto_answered && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500 text-white">
                    AUTO
                  </span>
                )}
              </div>
              <p className="text-gray-300 text-xs font-mono mt-0.5 truncate">{call.caller_number}</p>
              {elapsed > 0 && (
                <p className="text-gray-500 text-[10px] mt-0.5">{minutes}:{seconds} elapsed</p>
              )}
            </div>
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-white transition-colors p-1 shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Tenant match or unknown */}
            {hasMatch ? (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-blue-700 font-bold text-sm">
                    {call.tenant_name!.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{call.tenant_name}</p>
                  <p className="text-xs text-gray-500 truncate">{call.tenant_email}</p>
                  {(call.unit_label || call.property_name) && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {call.unit_label} · {call.property_name}
                    </p>
                  )}
                </div>
                {call.balance_due != null && (
                  <div className={`shrink-0 text-right ${call.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    <p className="text-[10px] text-gray-400">Balance</p>
                    <p className="text-sm font-bold">
                      KSh {call.balance_due.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-amber-50 rounded-lg px-3 py-2.5">
                <span className="text-xl">🔍</span>
                <div>
                  <p className="text-xs font-semibold text-amber-800">Unknown caller</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    No tenant record matched this number. Could be a new prospect.
                  </p>
                </div>
              </div>
            )}

            {/* Open tickets */}
            {call.open_tickets && call.open_tickets.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Open Tickets ({call.open_tickets.length})
                </p>
                <div className="space-y-1.5">
                  {call.open_tickets.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-gray-50 border border-gray-100">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_COLOR[t.priority] ?? 'text-gray-600 bg-gray-100'}`}>
                        {t.priority}
                      </span>
                      <p className="text-xs text-gray-700 flex-1 truncate">{t.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLOR[t.status] ?? 'text-gray-600 bg-gray-100'}`}>
                        {t.status.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                  {call.open_tickets.length > 3 && (
                    <p className="text-[11px] text-gray-400 text-center">
                      +{call.open_tickets.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Auto-mode transcript */}
            {call.auto_answered && (
              <AutoModeTranscript text={call.transcript ?? ''} />
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              {!call.auto_answered ? (
                <>
                  <button className="flex-1 py-2.5 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                    <span>📞</span> Answer
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="flex-1 py-2.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>📵</span> Decline
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDismiss}
                  className="flex-1 py-2.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  Dismiss (AI handling)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
