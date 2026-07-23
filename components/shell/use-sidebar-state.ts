'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_SIDEBAR_STATE,
  parseSidebarState,
  serializeSidebarState,
  sidebarStorageKey,
  toggleSidebarMode,
  type SidebarState,
} from './sidebar-state'

/**
 * Per-user, persisted sidebar collapse state. SSR-safe: renders the default on the
 * server / first paint, then hydrates from localStorage after mount to avoid a
 * hydration mismatch (same pattern as theme-toggle.tsx).
 */
export function useSidebarState(userId: string) {
  const [state, setState] = useState<SidebarState>(DEFAULT_SIDEBAR_STATE)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setState(parseSidebarState(window.localStorage.getItem(sidebarStorageKey(userId))))
    setHydrated(true)
  }, [userId])

  const toggle = useCallback(() => {
    setState((prev) => {
      const next = toggleSidebarMode(prev)
      try {
        window.localStorage.setItem(sidebarStorageKey(userId), serializeSidebarState(next))
      } catch {
        // Private-mode / storage-disabled: keep working in-memory for this session.
      }
      return next
    })
  }, [userId])

  return { state, toggle, collapsed: state.mode === 'collapsed', hydrated }
}
