'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_PREFERENCES,
  moveSection,
  myWorkPreferencesKey,
  parseMyWorkPreferences,
  resetMyWorkPreferences,
  serializeMyWorkPreferences,
  toggleSection,
  type MyWorkPreferences,
} from '@/lib/my-work-preferences'

/**
 * Per-user, per-browser My Work layout.
 *
 * SSR-safe by construction: renders the DEFAULT order on the server and on the first paint,
 * then hydrates from storage after mount - the same pattern as useSidebarState, useDensity and
 * useRecentRecords, and the reason a customized layout cannot cause a hydration mismatch.
 *
 * ⚠️ `window.localStorage`, never the bare global. Node 22 defines its own `localStorage` that
 * is `undefined` without `--localstorage-file`, and vitest's jsdom points `window` at
 * `globalThis`, so a bare reference silently does nothing under test and says nothing about it.
 */
export function useMyWorkPreferences(userId: string | null | undefined) {
  const [preferences, setPreferences] = useState<MyWorkPreferences>(DEFAULT_PREFERENCES)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return
    try {
      setPreferences(parseMyWorkPreferences(window.localStorage.getItem(myWorkPreferencesKey(userId))))
    } catch {
      // Private mode or storage disabled: the defaults are a working page, not a failure.
    }
    setHydrated(true)
  }, [userId])

  const persist = useCallback(
    (next: MyWorkPreferences) => {
      setPreferences(next)
      if (!userId || typeof window === 'undefined') return
      try {
        window.localStorage.setItem(myWorkPreferencesKey(userId), serializeMyWorkPreferences(next))
      } catch {
        // Keep working in-memory for this session rather than losing the interaction.
      }
    },
    [userId],
  )

  return {
    preferences,
    hydrated,
    toggle: useCallback((id: string) => persist(toggleSection(preferences, id)), [persist, preferences]),
    move: useCallback((id: string, delta: number) => persist(moveSection(preferences, id, delta)), [persist, preferences]),
    reset: useCallback(() => persist(resetMyWorkPreferences()), [persist]),
  }
}
