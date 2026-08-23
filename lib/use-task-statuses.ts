import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StatusCategory } from '@/lib/task-status'

export interface TaskStatus {
  id?: string
  key: string
  label: string
  color: string
  position?: number
  is_archived?: boolean
  /**
   * Normalized meaning (migration 112). Every consumer that asks "is this open, started or
   * closed" resolves it through this, not through the letters of `key` - see lib/task-status.ts.
   * Optional on the type only because a caller may hand-build a status; the column is NOT NULL.
   */
  category?: StatusCategory
  /** Generated in Postgres from `category`. Never written; never trust a local override. */
  is_closed?: boolean
  /** Optional lucide icon name. NULL means the consumer picks one from the category. */
  icon?: string | null
}

// Used as a fallback whenever the managed list can't be loaded, so the Status
// dropdowns are never empty (a task always has selectable statuses).
export const DEFAULT_STATUSES: TaskStatus[] = [
  { key: 'to_do', label: 'To Do', color: '#64748b', category: 'planned', is_closed: false },
  { key: 'in_progress', label: 'In Progress', color: '#ca8a04', category: 'started', is_closed: false },
  { key: 'done', label: 'Completed', color: '#16a34a', category: 'completed', is_closed: true },
  { key: 'cancelled', label: 'Cancelled', color: '#dc2626', category: 'cancelled', is_closed: true },
]

/**
 * The managed status list, plus a way to re-read it.
 *
 * `useTaskStatuses` below returns only the array, which is all six of its original callers
 * ever wanted. This variant exists for the one screen that can *change* a status label
 * without navigating: renaming a board column renames the status behind it, and every status
 * picker on the page is labelled from this list. Without a refetch those pickers keep
 * offering the old name until the component remounts, so the board would show the new column
 * title beside a dropdown still saying the old one.
 */
export function useTaskStatusList({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  const [statuses, setStatuses] = useState<TaskStatus[]>(DEFAULT_STATUSES)

  // A ref, not state: `refetch` must keep a stable identity so callers can list it in a
  // dependency array without re-subscribing on every render.
  const activeRef = useRef(true)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('task_statuses')
      .select('id, key, label, color, position, is_archived, category, is_closed, icon')
      .order('position', { ascending: true })
      .order('label', { ascending: true })

    // An empty result is a failed read or an unseeded table, not "there are no statuses" -
    // so DEFAULT_STATUSES stays in place rather than emptying every picker on the page.
    if (!activeRef.current || !data || data.length === 0) return
    setStatuses(includeArchived ? data : data.filter((s: TaskStatus) => !s.is_archived))
  }, [includeArchived])

  useEffect(() => {
    activeRef.current = true
    void refetch()
    return () => {
      activeRef.current = false
    }
  }, [refetch])

  return { statuses, refetch }
}

export function useTaskStatuses(options: { includeArchived?: boolean } = {}) {
  return useTaskStatusList(options).statuses
}
