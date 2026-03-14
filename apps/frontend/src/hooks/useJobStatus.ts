import { useEffect, useRef, useState } from 'react'
import apiClient from '@/api/client'

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'retrying'

interface JobState {
  status: JobStatus | null
  result: unknown
  error: string | null
  loading: boolean
}

const TERMINAL_STATES: JobStatus[] = ['completed', 'failed']
const POLL_INTERVAL_MS = 3000

export function useJobStatus(jobId: string | null): JobState {
  const [state, setState] = useState<JobState>({
    status: null,
    result: null,
    error: null,
    loading: false,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    setState((s) => ({ ...s, loading: true }))

    async function poll() {
      try {
        const { data } = await apiClient.get(`/jobs/${jobId}`)
        const status: JobStatus = data.status

        setState({
          status,
          result: data.result ?? null,
          error:
            typeof data.error === 'string'
              ? data.error
              : (data.error as Record<string, string> | null)?.message ?? null,
          loading: false,
        })

        if (TERMINAL_STATES.includes(status)) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      } catch {
        setState((s) => ({ ...s, loading: false }))
      }
    }

    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [jobId])

  return state
}
