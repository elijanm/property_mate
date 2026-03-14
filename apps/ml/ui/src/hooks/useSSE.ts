import { useEffect, useRef, useState, useCallback } from 'react'
import type { SSEEvent } from '@/types/inference'

export function useSSE(trainerFilter?: string) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    // EventSource cannot set Authorization headers — pass token as query param
    const token = localStorage.getItem('ml_token') ?? ''
    const params = new URLSearchParams({ token })
    if (trainerFilter) params.set('trainer', trainerFilter)
    const url = `/api/v1/events?${params.toString()}`
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('connected', () => setConnected(true))
    es.addEventListener('ping', () => {/* keepalive */})

    const handleEvent = (type: string) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setEvents(prev => [{ type: type as SSEEvent['type'], data }, ...prev].slice(0, 200))
      } catch {}
    }

    es.addEventListener('inference', handleEvent('inference'))
    es.addEventListener('feedback', handleEvent('feedback'))
    es.addEventListener('training', handleEvent('training'))

    es.onerror = () => {
      setConnected(false)
      es.close()
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }

    return () => { es.close(); setConnected(false) }
  }, [trainerFilter])

  useEffect(() => {
    const cleanup = connect()
    return cleanup
  }, [connect])

  const clearEvents = () => setEvents([])

  return { events, connected, clearEvents }
}
