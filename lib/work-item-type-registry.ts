// Work item types - the pure registry, framework-free.
//
// ⚠️ This file exists SEPARATELY from lib/work-item-types.ts for the reason
// lib/module-registry.ts does: a Server Component may not import a module that reaches
// `useEffect`, and lib/work-item-types.ts holds the hook. Anything a server component or a
// plain test needs - the fallback list, the hierarchy rules, the type lookup - lives here and
// is re-exported there, so no existing import has to know about the split. Turbopack catches
// this class of mistake; `tsc` does not.
//
// ⚠️ These rules MIRROR private.enforce_work_item_type_hierarchy. The database is the
// authority; this exists so a picker never offers something that would be refused on save.

export interface WorkItemType {
  id?: string
  key: string
  name: string
  plural_name?: string | null
  description?: string | null
  icon?: string | null
  color: string
  default_status_key?: string | null
  can_have_children: boolean
  can_be_child: boolean
  /** NULL means any type that can_have_children. Non-null narrows to exactly these keys. */
  allowed_parent_type_keys?: string[] | null
  is_agile_eligible: boolean
  is_active: boolean
  /** A system type cannot be deactivated, renamed by key, or deleted. */
  is_system: boolean
  position: number
}

/**
 * The two types the product renders today, used whenever the managed list cannot be read so
 * no picker is ever empty. Deliberately only the ACTIVE two: a fallback that offered Bug and
 * Risk would let someone pick a type the database refuses.
 */
export const DEFAULT_WORK_ITEM_TYPES: WorkItemType[] = [
  {
    key: 'task', name: 'Task', plural_name: 'Tasks', icon: 'CircleCheck', color: '#6366f1',
    default_status_key: 'to_do', can_have_children: true, can_be_child: true,
    allowed_parent_type_keys: null, is_agile_eligible: true, is_active: true, is_system: true, position: 0,
  },
  {
    key: 'subtask', name: 'Subtask', plural_name: 'Subtasks', icon: 'ListTree', color: '#8b5cf6',
    default_status_key: 'to_do', can_have_children: false, can_be_child: true,
    allowed_parent_type_keys: null, is_agile_eligible: false, is_active: true, is_system: true, position: 1,
  },
]

export const TASK_TYPE_KEY = 'task'
export const SUBTASK_TYPE_KEY = 'subtask'

/** Types offered when creating a top-level work item. */
export function creatableTypes(types: WorkItemType[] | null | undefined): WorkItemType[] {
  return (types ?? []).filter((t) => t.is_active).sort((a, b) => a.position - b.position)
}

/**
 * Types offered when creating a TOP-LEVEL work item.
 *
 * Everything active except Subtask, which is definitionally a child - it exists to sit under
 * something else, and creating a loose one produces a card the board has nowhere to put.
 *
 * ⚠️ That exclusion is by key, not by inference. `can_be_child && !can_have_children` would
 * also match a Risk or an Approval that a workspace legitimately wants to raise on its own, so
 * generalising it would quietly remove types from this picker. If more than one type ever
 * needs to be child-only, that wants a real `can_be_top_level` column rather than a cleverer
 * predicate here.
 */
export function topLevelTypes(types: WorkItemType[] | null | undefined): WorkItemType[] {
  return creatableTypes(types).filter((t) => t.key !== SUBTASK_TYPE_KEY)
}

/**
 * Types offered when adding a child to a parent of `parentTypeKey`.
 *
 * Returns nothing when the parent's type cannot have children at all - the caller should hide
 * the "add subtask" control rather than show an empty picker.
 */
export function childTypesFor(
  types: WorkItemType[] | null | undefined,
  parentTypeKey: string | null | undefined,
): WorkItemType[] {
  const all = creatableTypes(types)
  const parent = all.find((t) => t.key === parentTypeKey)

  // No parent in scope, or a type the catalog does not know - which means it has not loaded,
  // not that the parent is childless. Fails OPEN, matching statusesAvailableOnBoard: the
  // database still refuses anything genuinely impossible, and an empty picker reads as a
  // broken control rather than as an answer.
  if (!parent) return all.filter((t) => t.can_be_child)

  if (!parent.can_have_children) return []

  return all.filter((t) => {
    if (!t.can_be_child) return false
    if (t.allowed_parent_type_keys?.length) return t.allowed_parent_type_keys.includes(parent.key)
    return true
  })
}

/** Can an item of `childTypeKey` sit under one of `parentTypeKey`? Mirrors the trigger. */
export function canNest(
  types: WorkItemType[] | null | undefined,
  childTypeKey: string,
  parentTypeKey: string,
): boolean {
  return childTypesFor(types, parentTypeKey).some((t) => t.key === childTypeKey)
}

/** The type a work item holds, or the Task fallback so a card always has something to show. */
export function typeFor(
  types: WorkItemType[] | null | undefined,
  typeKey: string | null | undefined,
): WorkItemType {
  const match = (types ?? []).find((t) => t.key === typeKey)
  if (match) return match
  return (types ?? []).find((t) => t.key === TASK_TYPE_KEY)
    ?? DEFAULT_WORK_ITEM_TYPES[0]
}

/** What a new item of this type starts as, falling back to the board's own default. */
export function defaultStatusFor(
  types: WorkItemType[] | null | undefined,
  typeKey: string | null | undefined,
): string | null {
  return typeFor(types, typeKey).default_status_key ?? null
}

/**
 * Why a type cannot be switched off, or null when it can. Mirrors
 * private.protect_system_work_item_types plus the one rule that lives above the database:
 * turning off a type that work already uses hides nothing but confuses every picker.
 */
export function deactivationBlockedReason(
  type: WorkItemType,
  inUseCount: number,
): string | null {
  if (type.is_system) {
    return `${type.name} is built in and cannot be switched off.`
  }
  if (inUseCount > 0) {
    return `${inUseCount} work item${inUseCount === 1 ? '' : 's'} still use this type. `
      + 'They keep it, but no new ones can be created with it.'
  }
  return null
}
