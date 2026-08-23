import { describe, it, expect } from 'vitest'
import {
  creatableTypes,
  childTypesFor,
  topLevelTypes,
  canNest,
  typeFor,
  defaultStatusFor,
  deactivationBlockedReason,
  DEFAULT_WORK_ITEM_TYPES,
  TASK_TYPE_KEY,
  SUBTASK_TYPE_KEY,
  type WorkItemType,
} from './work-item-type-registry'

function type(over: Partial<WorkItemType> & { key: string }): WorkItemType {
  return {
    key: over.key,
    name: over.name ?? over.key,
    color: over.color ?? '#000000',
    can_have_children: over.can_have_children ?? true,
    can_be_child: over.can_be_child ?? true,
    allowed_parent_type_keys: over.allowed_parent_type_keys ?? null,
    is_agile_eligible: over.is_agile_eligible ?? true,
    is_active: over.is_active ?? true,
    is_system: over.is_system ?? false,
    position: over.position ?? 0,
    default_status_key: over.default_status_key ?? null,
    icon: over.icon ?? null,
  }
}

const CATALOG: WorkItemType[] = [
  type({ key: 'task', name: 'Task', is_system: true, position: 0, default_status_key: 'to_do' }),
  type({ key: 'subtask', name: 'Subtask', is_system: true, can_have_children: false, position: 1 }),
  type({ key: 'bug', name: 'Bug', position: 2, default_status_key: 'to_do' }),
  type({ key: 'epic', name: 'Epic', can_be_child: false, position: 3 }),
  type({ key: 'story', name: 'Story', allowed_parent_type_keys: ['epic'], position: 4 }),
  type({ key: 'risk', name: 'Risk', is_active: false, position: 5 }),
]

describe('the fallback registry', () => {
  it('offers only the two types the product actually renders', () => {
    // A fallback listing Bug or Risk would let someone pick a type the database refuses,
    // because those are seeded inactive.
    expect(DEFAULT_WORK_ITEM_TYPES.map((t) => t.key)).toEqual([TASK_TYPE_KEY, SUBTASK_TYPE_KEY])
    expect(DEFAULT_WORK_ITEM_TYPES.every((t) => t.is_active)).toBe(true)
  })

  it('agrees with the migration that a subtask cannot have children', () => {
    // 060 forbids two levels regardless; the type must not claim otherwise.
    expect(DEFAULT_WORK_ITEM_TYPES.find((t) => t.key === SUBTASK_TYPE_KEY)?.can_have_children).toBe(false)
  })

  it('marks both fallback types as system, matching the seed', () => {
    expect(DEFAULT_WORK_ITEM_TYPES.every((t) => t.is_system)).toBe(true)
  })
})

describe('creatableTypes', () => {
  it('drops inactive types and orders by position', () => {
    expect(creatableTypes(CATALOG).map((t) => t.key)).toEqual(['task', 'subtask', 'bug', 'epic', 'story'])
  })

  it('handles an absent catalog', () => {
    expect(creatableTypes(null)).toEqual([])
    expect(creatableTypes(undefined)).toEqual([])
  })
})

describe('topLevelTypes', () => {
  it('offers every active type except Subtask', () => {
    expect(topLevelTypes(CATALOG).map((t) => t.key)).toEqual(['task', 'bug', 'epic', 'story'])
  })

  it('does not exclude other childless types - only Subtask is definitionally a child', () => {
    // A Risk that cannot have children is still something you raise on its own.
    const withRisk = [...CATALOG, type({ key: 'risk_open', name: 'Open Risk', can_have_children: false, position: 9 })]
    expect(topLevelTypes(withRisk).map((t) => t.key)).toContain('risk_open')
  })

  it('never offers an inactive type', () => {
    expect(topLevelTypes(CATALOG).map((t) => t.key)).not.toContain('risk')
  })

  it('leaves exactly one option in the default workspace, so no picker need be shown', () => {
    // 113 seeds only task and subtask active, so until a super admin switches something on
    // the create dialog has nothing to ask about and must not grow a control.
    expect(topLevelTypes(DEFAULT_WORK_ITEM_TYPES).map((t) => t.key)).toEqual(['task'])
  })
})

describe('childTypesFor - mirrors the hierarchy trigger', () => {
  it('refuses every child under a type that cannot have children', () => {
    expect(childTypesFor(CATALOG, 'subtask')).toEqual([])
  })

  it('drops a type that can never be a child', () => {
    expect(childTypesFor(CATALOG, 'task').map((t) => t.key)).not.toContain('epic')
  })

  it('honours allowed_parent_type_keys', () => {
    // Story names Epic as its only permitted parent.
    expect(childTypesFor(CATALOG, 'task').map((t) => t.key)).not.toContain('story')
    expect(childTypesFor(CATALOG, 'epic').map((t) => t.key)).toContain('story')
  })

  it('allows a type with no parent restriction under any parent that can have children', () => {
    expect(childTypesFor(CATALOG, 'task').map((t) => t.key)).toEqual(['task', 'subtask', 'bug'])
    expect(childTypesFor(CATALOG, 'bug').map((t) => t.key)).toEqual(['task', 'subtask', 'bug'])
  })

  it('fails OPEN when the parent type is unknown or the catalog has not loaded', () => {
    // An empty picker reads as a broken control. The database still refuses the impossible.
    const unknown = childTypesFor(CATALOG, 'not_a_type').map((t) => t.key)
    expect(unknown).toEqual(['task', 'subtask', 'bug', 'story'])
    expect(childTypesFor(CATALOG, null).map((t) => t.key)).toEqual(unknown)
    expect(childTypesFor(null, 'task')).toEqual([])
  })

  it('never offers an inactive type as a child', () => {
    for (const parent of ['task', 'bug', 'epic', 'unknown']) {
      expect(childTypesFor(CATALOG, parent).map((t) => t.key)).not.toContain('risk')
    }
  })
})

describe('canNest', () => {
  it('agrees with childTypesFor for every pair', () => {
    for (const parent of CATALOG) {
      const allowed = new Set(childTypesFor(CATALOG, parent.key).map((t) => t.key))
      for (const child of CATALOG) {
        expect(canNest(CATALOG, child.key, parent.key)).toBe(allowed.has(child.key))
      }
    }
  })

  it('refuses a subtask as a parent', () => {
    expect(canNest(CATALOG, 'task', 'subtask')).toBe(false)
  })

  it('allows a subtask under a task', () => {
    expect(canNest(CATALOG, 'subtask', 'task')).toBe(true)
  })
})

describe('typeFor', () => {
  it('resolves a known key', () => {
    expect(typeFor(CATALOG, 'bug').name).toBe('Bug')
  })

  it('falls back to Task rather than rendering a card with no type at all', () => {
    expect(typeFor(CATALOG, 'gone').key).toBe('task')
    expect(typeFor(CATALOG, null).key).toBe('task')
    expect(typeFor([], 'bug').key).toBe('task')
    expect(typeFor(null, null).key).toBe('task')
  })

  it('resolves an INACTIVE type a work item still holds', () => {
    // Deactivating Risk must not make existing risks render as tasks - they are still risks.
    expect(typeFor(CATALOG, 'risk').name).toBe('Risk')
  })
})

describe('defaultStatusFor', () => {
  it('returns the type\'s own default', () => {
    expect(defaultStatusFor(CATALOG, 'bug')).toBe('to_do')
  })

  it('is null when the type declares none, so the caller uses the board\'s default', () => {
    expect(defaultStatusFor(CATALOG, 'epic')).toBeNull()
  })
})

describe('deactivationBlockedReason', () => {
  it('refuses to switch off a system type', () => {
    expect(deactivationBlockedReason(typeFor(CATALOG, 'task'), 0)).toMatch(/built in/)
  })

  it('warns, by name and count, when work still uses the type', () => {
    const reason = deactivationBlockedReason(typeFor(CATALOG, 'bug'), 3)
    expect(reason).toMatch(/3 work items/)
    expect(reason).toMatch(/They keep it/)
  })

  it('says "work item" in the singular for one', () => {
    expect(deactivationBlockedReason(typeFor(CATALOG, 'bug'), 1)).toMatch(/1 work item still/)
  })

  it('allows switching off an unused non-system type', () => {
    expect(deactivationBlockedReason(typeFor(CATALOG, 'bug'), 0)).toBeNull()
  })
})
