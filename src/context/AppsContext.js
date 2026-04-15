import { createContext, useContext } from 'react'

export const AppsContext = createContext(null)

export function useAppsContext() {
  const ctx = useContext(AppsContext)
  if (!ctx) throw new Error('useAppsContext must be used inside AppsContext.Provider')
  return ctx
}
