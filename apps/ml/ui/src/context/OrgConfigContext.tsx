import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { orgConfigApi, type OrgConfig } from '@/api/orgConfig'

interface OrgConfigContextValue {
  orgConfig: OrgConfig | null
  loading: boolean
  refetch: () => void
}

const OrgConfigContext = createContext<OrgConfigContextValue>({
  orgConfig: null,
  loading: false,
  refetch: () => {},
})

export function OrgConfigProvider({ children }: { children: ReactNode }) {
  const [orgConfig, setOrgConfig] = useState<OrgConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    orgConfigApi.get()
      .then(setOrgConfig)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refetch() }, [refetch])

  return (
    <OrgConfigContext.Provider value={{ orgConfig, loading, refetch }}>
      {children}
    </OrgConfigContext.Provider>
  )
}

export function useOrgConfig() {
  return useContext(OrgConfigContext)
}
