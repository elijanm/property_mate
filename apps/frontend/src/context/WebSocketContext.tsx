/**
 * WebSocketContext — real-time notifications via Redis pub/sub forwarded through
 * the FastAPI WebSocket endpoint at GET /api/v1/ws?token=<jwt>.
 *
 * Auto-reconnects with exponential backoff (1→2→4→8→16→30s cap).
 * Stores the last 50 notifications in state and tracks unreadCount.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

type NotificationHandler = (notification: WsNotification) => void
import { TOKEN_KEY } from '@/constants/storage'
import { useSound } from '@/hooks/useSound'

export interface WsNotification {
  id: string
  type: string
  title: string
  message: string
  data?: unknown
  org_id: string
  timestamp: string
}

interface WebSocketContextValue {
  notifications: WsNotification[]
  unreadCount: number
  markAllRead: () => void
  connected: boolean
  /** Subscribe to all incoming notifications. Returns an unsubscribe function. */
  subscribe: (handler: NotificationHandler) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  connected: false,
  subscribe: () => () => {},
})

const MAX_NOTIFICATIONS = 50
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

function getWsBaseUrl(): string {
  // Mirror the same baseURL construction used in api/client.ts
  const apiBase = import.meta.env.VITE_API_BASE_URL
    ? `${import.meta.env.VITE_API_BASE_URL as string}/api/v1`
    : '/api/v1'
  if (apiBase.startsWith('http')) {
    return apiBase.replace(/^http/, 'ws')
  }
  // Relative URL (Vite proxy) — derive from window.location
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${apiBase}`
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<WsNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [connected, setConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountedRef = useRef(false)
  const handlersRef = useRef<Set<NotificationHandler>>(new Set())

  const { playNotificationSound } = useSound()
  // Use a ref so connect() never needs to re-create when sound fn identity changes
  const playSoundRef = useRef(playNotificationSound)
  playSoundRef.current = playNotificationSound

  const connect = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token || unmountedRef.current) return

    const url = `${getWsBaseUrl()}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return }
      setConnected(true)
      retryCountRef.current = 0
    }

    ws.onmessage = (ev) => {
      try {
        const notification: WsNotification = JSON.parse(ev.data as string)
        setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS))
        setUnreadCount((n) => n + 1)
        playSoundRef.current()
        handlersRef.current.forEach((h) => h(notification))
      } catch {
        // Malformed message — ignore
      }
    }

    ws.onclose = () => {
      setConnected(false)
      if (unmountedRef.current) return
      // Reconnect with backoff
      const delay =
        BACKOFF_DELAYS[Math.min(retryCountRef.current, BACKOFF_DELAYS.length - 1)]
      retryCountRef.current += 1
      retryTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) connect()
      }, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, []) // stable — no deps needed because all mutable values accessed via refs

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const markAllRead = useCallback(() => setUnreadCount(0), [])

  const subscribe = useCallback((handler: NotificationHandler) => {
    handlersRef.current.add(handler)
    return () => { handlersRef.current.delete(handler) }
  }, [])

  return (
    <WebSocketContext.Provider value={{ notifications, unreadCount, markAllRead, connected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  return useContext(WebSocketContext)
}
