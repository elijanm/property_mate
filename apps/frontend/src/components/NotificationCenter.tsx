/**
 * NotificationCenter — bell icon + badge in the header, with dropdown of recent
 * notifications and a toast for the latest incoming message.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket, type WsNotification } from '@/context/WebSocketContext'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function typeIcon(type: string): string {
  if (type.startsWith('billing_run')) return '🧾'
  if (type.startsWith('ticket')) return '🎫'
  if (type.startsWith('payment')) return '💳'
  if (type.startsWith('invoice')) return '📄'
  return '🔔'
}

function navPathForType(type: string): string | null {
  if (type.startsWith('billing_run')) return '/owner/accounting/invoices'
  if (type.startsWith('ticket')) return '/owner/tickets'
  if (type.startsWith('payment') || type.startsWith('invoice')) return '/owner/accounting/invoices'
  return null
}

interface ToastProps {
  notification: WsNotification
  onDismiss: () => void
}

function Toast({ notification, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed bottom-5 right-5 z-[10000] flex items-start gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-2">
      <span className="text-xl shrink-0 mt-0.5">{typeIcon(notification.type)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{notification.title}</p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notification.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="text-gray-300 hover:text-gray-500 shrink-0 text-lg leading-none ml-1"
      >
        ×
      </button>
    </div>
  )
}

export default function NotificationCenter() {
  const { notifications, unreadCount, markAllRead } = useWebSocket()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<WsNotification | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Show toast on new notifications
  const prevCountRef = useRef(notifications.length)
  useEffect(() => {
    if (notifications.length > prevCountRef.current) {
      setToast(notifications[0])
    }
    prevCountRef.current = notifications.length
  }, [notifications])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleOpen() {
    setOpen((v) => !v)
    if (!open) markAllRead()
  }

  function handleNotificationClick(n: WsNotification) {
    setOpen(false)
    const path = navPathForType(n.type)
    if (path) navigate(path)
  }

  return (
    <>
      {/* Bell button */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={handleOpen}
          className="relative flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Notifications"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute right-0 top-10 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              {notifications.length > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {notifications.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">
                  No notifications yet
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className="text-lg shrink-0 mt-0.5">{typeIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-300 mt-1">{timeAgo(n.timestamp)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <Toast notification={toast} onDismiss={() => setToast(null)} />
      )}
    </>
  )
}
