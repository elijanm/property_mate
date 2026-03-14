import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { setGlobalErrorHandler } from '@/api/client'

interface Toast {
  id: string
  type: 'error' | 'success' | 'info'
  message: string
}

interface ToastContextValue {
  showToast: (message: string, type?: Toast['type']) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (message: string, type: Toast['type'] = 'error') => {
      setToasts((prev) => {
        // Deduplicate: if same message+type is already visible, skip
        if (prev.some((t) => t.message === message && t.type === type)) return prev
        const id = Math.random().toString(36).slice(2, 10)
        const timer = setTimeout(() => dismiss(id), 5000)
        timers.current.set(id, timer)
        return [...prev.slice(-4), { id, type, message }]
      })
    },
    [dismiss],
  )

  // Register as the global error handler for axios interceptor
  useEffect(() => {
    setGlobalErrorHandler(showToast)
    return () => setGlobalErrorHandler(null)
  }, [showToast])

  // Cleanup all timers on unmount
  useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => clearTimeout(t))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const bg =
    toast.type === 'error'
      ? 'bg-red-600'
      : toast.type === 'success'
        ? 'bg-green-600'
        : 'bg-blue-600'

  const icon =
    toast.type === 'error' ? '✕' : toast.type === 'success' ? '✓' : 'ℹ'

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg max-w-sm text-sm text-white ${bg}`}
      role="alert"
    >
      <span className="shrink-0 mt-px font-bold">{icon}</span>
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
