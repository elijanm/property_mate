import { useContext } from 'react'
import { OrgContext } from '@/context/OrgContext'

export function useOrgProfile() {
  return useContext(OrgContext)
}
