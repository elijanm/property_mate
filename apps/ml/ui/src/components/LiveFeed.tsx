import { useSSE } from '@/hooks/useSSE'
import clsx from 'clsx'
import { Activity, Wifi, WifiOff } from 'lucide-react'
import type { SSEEvent } from '@/types/inference'

interface Props { trainerFilter?: string }

export default function LiveFeed({ trainerFilter }: Props) {
  const { events, connected, clearEvents } = useSSE(trainerFilter)
  const inferenceEvents = events.filter(e => e.type === 'inference')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-brand-500" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Live Feed</span>
          {connected
            ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />Live</span>
            : <span className="flex items-center gap-1 text-[10px] text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Reconnecting</span>
          }
        </div>
        {events.length > 0 && (
          <button onClick={clearEvents} className="text-[10px] text-gray-600 hover:text-gray-400">clear</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {inferenceEvents.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-xs">Waiting for requests…</div>
        )}
        {inferenceEvents.map((ev, i) => (
          <EventRow key={i} event={ev} />
        ))}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: SSEEvent }) {
  const d = event.data
  const isErr = d.has_error
  return (
    <div className={clsx('rounded-lg p-2 text-xs border', isErr
      ? 'bg-red-950/30 border-red-900/50 text-red-300'
      : 'bg-gray-900/60 border-gray-800 text-gray-300'
    )}>
      <div className="flex items-center justify-between">
        <span className="font-medium truncate max-w-[100px]">{String(d.trainer_name ?? '—')}</span>
        {d.latency_ms != null && (
          <span className={clsx('text-[10px]', isErr ? 'text-red-400' : 'text-gray-500')}>
            {Number(d.latency_ms).toFixed(0)}ms
          </span>
        )}
      </div>
      {d.model_version && <div className="text-[10px] text-gray-600 mt-0.5">v{String(d.model_version)}</div>}
      {isErr && d.error && <div className="text-[10px] text-red-400 mt-0.5 truncate">{String(d.error)}</div>}
    </div>
  )
}
