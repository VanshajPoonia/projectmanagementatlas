'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DENSITY, densityStorageKey, parseDensity, type Density } from './density'

/**
 * Per-user, persisted view density. SSR-safe: the default renders on the server and
 * first paint, then hydrates from localStorage after mount - same pattern as
 * useSidebarState.
 *
 * `hydrated` is exposed so a surface that must not flash the wrong density (a long
 * board) can hold off its transition until the real preference is known.
 */
export function useDensity(userId: string) {
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setDensityState(parseDensity(window.localStorage.getItem(densityStorageKey(userId))))
    setHydrated(true)
  }, [userId])

  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next)
      try {
        window.localStorage.setItem(densityStorageKey(userId), next)
      } catch {
        // Private-mode / storage-disabled: keep the choice in memory for this session.
      }
    },
    [userId],
  )

  return { density, setDensity, hydrated }
}
