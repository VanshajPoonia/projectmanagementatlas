'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  forgetRecord,
  parseRecentRecords,
  recentStorageKey,
  rememberRecord,
  serializeRecentRecords,
  type RecentRecord,
} from './recent-records'

/**
 * Per-user, persisted "recently viewed" list. SSR-safe: renders empty on the server and
 * first paint, then hydrates from localStorage after mount - same pattern as
 * useSidebarState, and the reason the Recent block can't cause a hydration mismatch.
 */
export function useRecentRecords(userId: string) {
  const [records, setRecords] = useState<RecentRecord[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setRecords(parseRecentRecords(window.localStorage.getItem(recentStorageKey(userId))))
  }, [userId])

  const persist = useCallback(
    (next: RecentRecord[]) => {
      try {
        window.localStorage.setItem(recentStorageKey(userId), serializeRecentRecords(next))
      } catch {
        // Private-mode / storage-disabled: keep working in-memory for this session.
      }
      return next
    },
    [userId],
  )

  const remember = useCallback(
    (entry: Omit<RecentRecord, 'at'>) => {
      setRecords((prev) => persist(rememberRecord(prev, entry)))
    },
    [persist],
  )

  const forget = useCallback(
    (key: string) => {
      setRecords((prev) => persist(forgetRecord(prev, key)))
    },
    [persist],
  )

  return { records, remember, forget }
}

/**
 * Fire-and-forget variant for pages that only ever *write* one visit and never read the
 * list back (a board page, a task route). Avoids re-rendering the page on every
 * localStorage round-trip, which the read-and-render hook above would cause.
 */
export function useRememberRecord(userId: string, entry: Omit<RecentRecord, 'at'> | null) {
  const key = entry?.key
  const label = entry?.label
  const href = entry?.href
  const kind = entry?.kind

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!key || !label || !href || !kind) return
    const storageKey = recentStorageKey(userId)
    try {
      const current = parseRecentRecords(window.localStorage.getItem(storageKey))
      window.localStorage.setItem(
        storageKey,
        serializeRecentRecords(rememberRecord(current, { key, label, href, kind })),
      )
    } catch {
      // Storage unavailable - recents are a convenience, never a hard requirement.
    }
  }, [userId, key, label, href, kind])
}
