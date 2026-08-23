// Work item types - the React hook, and a re-export of the pure registry.
//
// The data and the rules live in lib/work-item-type-registry.ts, framework-free, because a
// Server Component cannot import a module that reaches `useEffect`. Everything is re-exported
// here so a client component has one import to make.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_WORK_ITEM_TYPES, type WorkItemType } from '@/lib/work-item-type-registry'

export * from '@/lib/work-item-type-registry'

// ---------------------------------------------------------------------------------------
// The hook. Mirrors useTaskStatusList: seedable from the server, refetchable, never empty.
// ---------------------------------------------------------------------------------------

const SELECT_COLUMNS =
  'id, key, name, plural_name, description, icon, color, default_status_key, '
  + 'can_have_children, can_be_child, allowed_parent_type_keys, is_agile_eligible, '
  + 'is_active, is_system, position'

export function useWorkItemTypeList(
  { includeInactive = false, seed }: { includeInactive?: boolean; seed?: WorkItemType[] } = {},
) {
  const [types, setTypes] = useState<WorkItemType[]>(seed ?? DEFAULT_WORK_ITEM_TYPES)

  // A ref, not state: `refetch` must keep a stable identity so callers can list it in a
  // dependency array without re-subscribing on every render.
  const activeRef = useRef(true)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('work_item_types')
      .select(SELECT_COLUMNS)
      .order('position', { ascending: true })
      .order('name', { ascending: true })

    // An empty result is a failed read or an unseeded table, not "there are no types" - so the
    // fallback stays in place rather than emptying every picker on the page.
    if (!activeRef.current || !data || data.length === 0) return
    const rows = data as unknown as WorkItemType[]
    setTypes(includeInactive ? rows : rows.filter((t) => t.is_active))
  }, [includeInactive])

  useEffect(() => {
    activeRef.current = true
    void refetch()
    return () => {
      activeRef.current = false
    }
  }, [refetch])

  return { types, refetch }
}

export function useWorkItemTypes(options: { includeInactive?: boolean; seed?: WorkItemType[] } = {}) {
  return useWorkItemTypeList(options).types
}
