import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { orgApi } from '@/api/org'
import type { OrgProfile } from '@/types/org'

interface OrgContextValue {
  orgProfile: OrgProfile | null
  loading: boolean
  refresh: () => void
}

export const OrgContext = createContext<OrgContextValue>({
  orgProfile: null,
  loading: true,
  refresh: () => {},
})

/**
 * Fetches the org profile for authenticated users that have an org_id.
 * Wrap inside AuthProvider so useAuth() is available.
 */
export function OrgProvider({
  children,
  orgId,
}: {
  children: React.ReactNode
  orgId: string | null | undefined
}) {
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null)
  const [loading, setLoading] = useState(!!orgId)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    setLoading(true)
    orgApi
      .getProfile()
      .then(setOrgProfile)
      .catch(() => setOrgProfile(null))
      .finally(() => setLoading(false))
  }, [orgId, tick])

  const value = useMemo(
    () => ({ orgProfile, loading, refresh }),
    [orgProfile, loading, refresh],
  )

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}
