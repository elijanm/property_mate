import { useState, useCallback, useRef } from 'react'

interface MfaSession {
  token: string
  expiresAt: number
}

export function useMfaSession() {
  const [session, setSession] = useState<MfaSession | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isUnlocked = session !== null && Date.now() < session.expiresAt

  const unlock = useCallback((token: string, expiresIn: number) => {
    const expiresAt = Date.now() + expiresIn * 1000
    setSession({ token, expiresAt })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSession(null), expiresIn * 1000)
  }, [])

  const lock = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSession(null)
  }, [])

  return {
    isUnlocked,
    token: session?.token ?? null,
    expiresAt: session?.expiresAt ?? null,
    unlock,
    lock,
  }
}
