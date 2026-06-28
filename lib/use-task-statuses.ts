import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface TaskStatus {
  id?: string
  key: string
  label: string
  color: string
  position?: number
  is_archived?: boolean
}

// Used as a fallback whenever the managed list can't be loaded, so the Status
// dropdowns are never empty (a task always has selectable statuses).
export const DEFAULT_STATUSES: TaskStatus[] = [
  { key: 'to_do', label: 'To Do', color: '#64748b' },
  { key: 'in_progress', label: 'In Progress', color: '#ca8a04' },
  { key: 'done', label: 'Done', color: '#16a34a' },
]

export function useTaskStatuses({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  const [statuses, setStatuses] = useState<TaskStatus[]>(DEFAULT_STATUSES)

  useEffect(() => {
    let active = true
    const supabase = createClient()
    supabase
      .from('task_statuses')
      .select('id, key, label, color, position, is_archived')
      .order('position', { ascending: true })
      .order('label', { ascending: true })
      .then(({ data }: { data: TaskStatus[] | null }) => {
        if (!active || !data || data.length === 0) return
        setStatuses(includeArchived ? data : data.filter((s: TaskStatus) => !s.is_archived))
      })
    return () => {
      active = false
    }
  }, [includeArchived])

  return statuses
}
