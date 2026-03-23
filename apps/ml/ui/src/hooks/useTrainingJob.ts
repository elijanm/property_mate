/**
 * useTrainingJob — tracks a training job via SSE.
 *
 * Features:
 * - Replays stored logs on reconnect (server sends full log_lines history first)
 * - Persists active job ID to localStorage so background jobs survive navigation
 * - Emits browser notification when a background job completes/fails
 * - Exposes `runInBackground()` to let user navigate away without losing tracking
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export interface TrainingJobState {
  jobId: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | null
  logs: string[]
  metrics: Record<string, number>
  error: string | null
  trainerName: string | null
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const STORAGE_KEY = (trainerName: string) => `ml_training_job:${trainerName}`

export function useTrainingJob(trainerName: string) {
  const [state, setState] = useState<TrainingJobState>({
    jobId: null,
    status: null,
    logs: [],
    metrics: {},
    error: null,
    trainerName,
  })
  const [isBackground, setIsBackground] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const _closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  const _openStream = useCallback((jobId: string) => {
    _closeStream()
    const token = localStorage.getItem('ml_token') ?? ''
    const url = `/api/v1/training/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('log', (e: MessageEvent) => {
      try {
        const { line } = JSON.parse(e.data)
        setState(prev => ({ ...prev, logs: [...prev.logs, line] }))
      } catch {}
    })

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data)
        setState(prev => ({
          ...prev,
          status: d.status ?? prev.status,
          metrics: d.metrics ?? prev.metrics,
          error: d.error ?? prev.error,
          trainerName: d.trainer_name ?? prev.trainerName,
        }))
      } catch {}
    })

    es.addEventListener('metrics', (e: MessageEvent) => {
      try {
        const { metrics } = JSON.parse(e.data)
        setState(prev => ({ ...prev, metrics: metrics ?? prev.metrics }))
      } catch {}
    })

    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const { status } = JSON.parse(e.data)
        setState(prev => ({ ...prev, status }))

        // Clear persisted job
        localStorage.removeItem(STORAGE_KEY(trainerName))

        // Browser notification for background jobs
        if (isBackground && 'Notification' in window && Notification.permission === 'granted') {
          const title = status === 'completed' ? '✅ Training complete' : '❌ Training failed'
          const body = `${trainerName} — ${status}`
          new Notification(title, { body })
        }
      } catch {}
      es.close()
      esRef.current = null
    })

    es.addEventListener('error', () => {
      // On SSE error, mark as disconnected but don't clear the job
      es.close()
      esRef.current = null
    })
  }, [trainerName, isBackground, _closeStream])

  // On mount: restore active job from localStorage and reconnect
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY(trainerName))
    if (stored) {
      try {
        const { jobId, status } = JSON.parse(stored)
        if (jobId && !TERMINAL.has(status)) {
          setState(prev => ({ ...prev, jobId, status }))
          _openStream(jobId)
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY(trainerName))
      }
    }
    return _closeStream
  }, [trainerName]) // eslint-disable-line react-hooks/exhaustive-deps

  const startTracking = useCallback((jobId: string) => {
    // Request notification permission opportunistically
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    localStorage.setItem(STORAGE_KEY(trainerName), JSON.stringify({ jobId, status: 'queued' }))
    setState({ jobId, status: 'queued', logs: [], metrics: {}, error: null, trainerName })
    setIsBackground(false)
    _openStream(jobId)
  }, [trainerName, _openStream])

  const runInBackground = useCallback(() => {
    setIsBackground(true)
    // Keep SSE alive — just hide the log panel in the UI
  }, [])

  const reconnect = useCallback(() => {
    if (state.jobId) _openStream(state.jobId)
  }, [state.jobId, _openStream])

  const dismiss = useCallback(() => {
    _closeStream()
    localStorage.removeItem(STORAGE_KEY(trainerName))
    setState({ jobId: null, status: null, logs: [], metrics: {}, error: null, trainerName })
    setIsBackground(false)
  }, [trainerName, _closeStream])

  return { state, isBackground, startTracking, runInBackground, reconnect, dismiss }
}

/** Returns count of trainers that have an active (non-terminal) job in localStorage. */
export function useRunningJobsCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const check = () => {
      let n = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('ml_training_job:')) {
          try {
            const { status } = JSON.parse(localStorage.getItem(key) ?? '{}')
            if (status && !TERMINAL.has(status)) n++
          } catch {}
        }
      }
      setCount(n)
    }
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])
  return count
}
