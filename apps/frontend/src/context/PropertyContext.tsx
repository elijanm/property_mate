import { createContext, useContext } from 'react'
import type { Property } from '@/types/property'

interface PropertyContextValue {
  property: Property | null
  refreshProperty: () => Promise<void>
}

const PropertyContext = createContext<PropertyContextValue>({
  property: null,
  refreshProperty: async () => {},
})

export const PropertyProvider = PropertyContext.Provider

export function useProperty(): Property | null {
  return useContext(PropertyContext).property
}

export function usePropertyContext(): PropertyContextValue {
  return useContext(PropertyContext)
}
