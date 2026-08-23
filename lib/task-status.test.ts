import { describe, it, expect } from 'vitest'
import {
  getNormalizedTaskStatus,
  getTaskStatusLabel,
  getEffectiveStatusKey,
  findColumnForStatus,
  statusesAvailableOnBoard,
  statusesMissingFromBoard,
  statusesForPicker,
  getTaskStatusCategory,
  bucketForCategory,
  isClosedCategory,
  isCancelledStatus,
  isOpenStatus,
  statusesForCreation,
  categoryForColumn,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  type StatusCategory,
  type NormalizedTaskStatus,
} from './task-status'

describe('getNormalizedTaskStatus - FK first (columns.status_key)', () => {
  it('trusts an explicit status_key even when the column title is unconventional', () => {
    // The whole point of Phase 1B: a board naming its column "WIP" must not be misread.
    expect(getNormalizedTaskStatus({ column: { title: 'WIP', status_key: 'in_progress' } })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ column: { title: 'Icebox', status_key: 'to_do' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'Shipped', status_key: 'done' } })).toBe('done')
    expect(getNormalizedTaskStatus({ column: { title: 'Scrapped', status_key: 'cancelled' } })).toBe('done')
  })

  it('an explicit status_key overrides a stale task.status', () => {
    expect(
      getNormalizedTaskStatus({ status: 'to_do', column: { title: 'WIP', status_key: 'in_progress' } }),
    ).toBe('in_progress')
  })
})

describe('getNormalizedTaskStatus - legacy fallback (no status_key)', () => {
  it('still classifies by conventional column titles', () => {
    expect(getNormalizedTaskStatus({ column: { title: 'In Progress' } })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ column: { title: 'Completed' } })).toBe('done')
    expect(getNormalizedTaskStatus({ column: { title: 'To Do' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'On Going Indefinitely' } })).toBe('in_progress')
  })

  it('reproduces the bug the FK fixes: an unconventional title without a key falls to to_do', () => {
    expect(getNormalizedTaskStatus({ column: { title: 'WIP' } })).toBe('to_do')
  })

  it('classifies by the raw status when there is no column', () => {
    expect(getNormalizedTaskStatus({ status: 'in_progress' })).toBe('in_progress')
    expect(getNormalizedTaskStatus({ status: 'cancelled' })).toBe('done')
    expect(getNormalizedTaskStatus({ status: 'to_do' })).toBe('to_do')
  })
})

describe('getTaskStatusLabel', () => {
  it('shows Cancelled distinctly via status_key', () => {
    expect(getTaskStatusLabel({ column: { title: 'Scrapped', status_key: 'cancelled' } })).toBe('Cancelled')
  })
  it('maps buckets to human labels', () => {
    expect(getTaskStatusLabel({ column: { title: 'WIP', status_key: 'in_progress' } })).toBe('In Progress')
    expect(getTaskStatusLabel({ column: { title: 'Shipped', status_key: 'done' } })).toBe('Completed')
    expect(getTaskStatusLabel({ column: { title: 'Backlog', status_key: 'to_do' } })).toBe('To Do')
  })
})

describe('getEffectiveStatusKey - FK first', () => {
  const columns = [
    { id: 'c1', title: 'WIP', status_key: 'in_progress' },
    { id: 'c2', title: 'Backlog', status_key: 'to_do' },
  ]
  const statuses = [
    { key: 'to_do', label: 'To Do' },
    { key: 'in_progress', label: 'In Progress' },
  ]

  it('returns the column status_key directly', () => {
    expect(getEffectiveStatusKey({ column_id: 'c1' }, columns, statuses)).toBe('in_progress')
  })

  it('falls back to a title→label match when a column has no status_key', () => {
    const cols = [{ id: 'c3', title: 'In Progress' }]
    expect(getEffectiveStatusKey({ column_id: 'c3' }, cols, statuses)).toBe('in_progress')
  })
})

describe('findColumnForStatus - FK first', () => {
  const columns = [
    { id: 'c1', title: 'WIP', status_key: 'in_progress' },
    { id: 'c2', title: 'Backlog', status_key: 'to_do' },
  ]

  it('finds the column explicitly mapped to the status', () => {
    expect(findColumnForStatus('in_progress', 'In Progress', columns)?.id).toBe('c1')
  })

  it('falls back to title / bucket when no column has the key', () => {
    const cols = [{ id: 'x', title: 'In Progress' }]
    expect(findColumnForStatus('in_progress', 'In Progress', cols)?.id).toBe('x')
  })
})


/**
 * Regression cover for a real report: picking a status the board had no column for filled in
 * the whole create-task form and then refused it on submit, telling the user - who was often
 * the admin - to "ask an admin". The pickers now offer only what the board can accept.
 */
describe('status pickers are scoped to what the board can accept', () => {
  const statuses = [
    { key: 'to_do', label: 'To Do' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'done', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]
  // EmpowerMe on production: To Do / In Progress / Completed linked, no Cancelled column,
  // plus two custom columns linked to nothing.
  const empowerMe = [
    { id: 'c1', title: 'To Do', status_key: 'to_do' },
    { id: 'c2', title: 'In Progress', status_key: 'in_progress' },
    { id: 'c3', title: 'Completed', status_key: 'done' },
    { id: 'c4', title: 'Notes', status_key: null },
    { id: 'c5', title: 'On going', status_key: null },
  ]

  it('offers only the statuses that resolve to a column', () => {
    expect(statusesAvailableOnBoard(statuses, empowerMe).map(s => s.key))
      .toEqual(['to_do', 'in_progress', 'done'])
  })

  it('reports the missing one so an admin can be prompted to add it', () => {
    expect(statusesMissingFromBoard(statuses, empowerMe).map(s => s.key)).toEqual(['cancelled'])
  })

  it('counts a column matched by title alone, not just by the FK', () => {
    // Legacy boards predating 063 have no status_key; an exact title match still resolves.
    const legacy = [{ id: 'c1', title: 'Cancelled', status_key: null }]
    expect(statusesAvailableOnBoard(statuses, legacy).map(s => s.key)).toEqual(['cancelled'])
  })

  it('does NOT count a column that merely buckets the same way', () => {
    // "On Going Indefinitely" buckets to in_progress, but nobody chose it for that status.
    const drifted = [{ id: 'c1', title: 'On Going Indefinitely', status_key: null }]
    expect(statusesAvailableOnBoard(statuses, drifted)).toEqual([])
  })

  it('counts a drifted column once it is explicitly linked', () => {
    const linked = [{ id: 'c1', title: 'On Going Indefinitely', status_key: 'in_progress' }]
    expect(statusesAvailableOnBoard(statuses, linked).map(s => s.key)).toEqual(['in_progress'])
  })

  describe('fail-open vs fail-closed on unknown columns', () => {
    it('offers everything when the columns are not loaded - an empty picker reads as broken', () => {
      expect(statusesAvailableOnBoard(statuses, null)).toEqual(statuses)
      expect(statusesAvailableOnBoard(statuses, undefined)).toEqual(statuses)
    })

    it('reports nothing missing when the columns are not loaded', () => {
      expect(statusesMissingFromBoard(statuses, null)).toEqual([])
      expect(statusesMissingFromBoard(statuses, undefined)).toEqual([])
    })

    it('offers nothing on a board with no columns at all', () => {
      expect(statusesAvailableOnBoard(statuses, [])).toEqual([])
    })
  })

  describe('statusesForPicker keeps the record its own status', () => {
    it('keeps a status whose column has gone, so the control never renders blank', () => {
      const keys = statusesForPicker(statuses, empowerMe, 'cancelled').map(s => s.key)
      expect(keys).toContain('cancelled')
      expect(keys).toEqual(['to_do', 'in_progress', 'done', 'cancelled'])
    })

    it('preserves the admin-defined order rather than appending the kept status', () => {
      const reordered = [
        { key: 'cancelled', label: 'Cancelled' },
        { key: 'to_do', label: 'To Do' },
        { key: 'done', label: 'Completed' },
      ]
      const cols = [{ id: 'c1', title: 'To Do', status_key: 'to_do' }]
      expect(statusesForPicker(reordered, cols, 'cancelled').map(s => s.key))
        .toEqual(['cancelled', 'to_do'])
    })

    it('adds nothing when the current status is already reachable', () => {
      expect(statusesForPicker(statuses, empowerMe, 'to_do').map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })

    it('ignores a status key that is not a defined status', () => {
      expect(statusesForPicker(statuses, empowerMe, 'legacy_junk').map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })

    it('does not duplicate when called with no key', () => {
      expect(statusesForPicker(statuses, empowerMe, null).map(s => s.key))
        .toEqual(['to_do', 'in_progress', 'done'])
    })
  })
})

// ---------------------------------------------------------------------------------------
// Migration 112: the normalized category, and the substring guess it replaces.
// ---------------------------------------------------------------------------------------

/** A workspace that added statuses whose names the legacy heuristic cannot read. */
const CATALOG: Array<{ key: string; label: string; category: StatusCategory }> = [
  { key: 'to_do', label: 'To Do', category: 'planned' },
  { key: 'in_progress', label: 'In Progress', category: 'started' },
  { key: 'done', label: 'Completed', category: 'completed' },
  { key: 'cancelled', label: 'Cancelled', category: 'cancelled' },
  // The four that break substring matching, one per failure mode.
  { key: 'wip', label: 'WIP', category: 'started' },
  { key: 'review', label: 'In Review', category: 'started' },
  { key: 'blocked', label: 'Blocked', category: 'started' },
  { key: 'shipped', label: 'Shipped', category: 'completed' },
  { key: 'icebox', label: 'Icebox', category: 'backlog' },
  { key: 'rejected', label: 'Rejected', category: 'cancelled' },
]

describe('getNormalizedTaskStatus - category beats the substring guess', () => {
  it('classifies statuses the heuristic gets wrong, once a catalog is supplied', () => {
    // Every one of these is misclassified as `to_do` without a catalog - that is the bug.
    const cases: Array<[string, NormalizedTaskStatus]> = [
      ['wip', 'in_progress'],
      ['review', 'in_progress'],
      ['blocked', 'in_progress'],
      ['shipped', 'done'],
      ['rejected', 'done'],
      ['icebox', 'to_do'],
    ]
    for (const [key, expected] of cases) {
      expect(getNormalizedTaskStatus({ column: { title: 'x', status_key: key } }, CATALOG)).toBe(expected)
    }
  })

  it('pins what the heuristic actually does without a catalog, so the gain is not theoretical', () => {
    // Documenting the wrong answers deliberately: if someone deletes the catalog argument
    // from a call site, these are the classifications that come back.
    expect(getNormalizedTaskStatus({ column: { title: 'x', status_key: 'wip' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'x', status_key: 'review' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'x', status_key: 'blocked' } })).toBe('to_do')
    expect(getNormalizedTaskStatus({ column: { title: 'x', status_key: 'shipped' } })).toBe('to_do')
  })

  it('changes nothing for the four seeded statuses - passing a catalog is behaviour-preserving', () => {
    for (const key of ['to_do', 'in_progress', 'done', 'cancelled']) {
      const task = { column: { title: 'anything', status_key: key } }
      expect(getNormalizedTaskStatus(task, CATALOG)).toBe(getNormalizedTaskStatus(task))
    }
  })

  it('resolves the denormalised tasks.status string against the catalog too', () => {
    expect(getNormalizedTaskStatus({ status: 'review' }, CATALOG)).toBe('in_progress')
    expect(getNormalizedTaskStatus({ status: 'In Progress' }, CATALOG)).toBe('in_progress')
  })

  it('falls back rather than guessing wrong when the catalog does not know the key', () => {
    // An unknown key must not silently resolve to some other status's category.
    expect(getNormalizedTaskStatus({ column: { status_key: 'in_progress_v2' } }, CATALOG)).toBe('in_progress')
    expect(getNormalizedTaskStatus({ column: { status_key: 'mystery' } }, CATALOG)).toBe('to_do')
  })

  it('treats an empty or absent catalog as "no catalog", not "no categories"', () => {
    const task = { column: { status_key: 'in_progress' } }
    expect(getNormalizedTaskStatus(task, [])).toBe('in_progress')
    expect(getNormalizedTaskStatus(task, null)).toBe('in_progress')
    expect(getNormalizedTaskStatus(task, undefined)).toBe('in_progress')
  })

  it('ignores a category value that is not one of the five', () => {
    const bogus = [{ key: 'weird', category: 'in-flight' as unknown as StatusCategory }]
    expect(getNormalizedTaskStatus({ column: { status_key: 'weird' } }, bogus)).toBe('to_do')
  })
})

describe('getTaskStatusCategory', () => {
  it('tells completed and cancelled apart, which the done bucket cannot', () => {
    expect(getNormalizedTaskStatus({ column: { status_key: 'done' } }, CATALOG)).toBe('done')
    expect(getNormalizedTaskStatus({ column: { status_key: 'cancelled' } }, CATALOG)).toBe('done')
    expect(getTaskStatusCategory({ column: { status_key: 'done' } }, CATALOG)).toBe('completed')
    expect(getTaskStatusCategory({ column: { status_key: 'cancelled' } }, CATALOG)).toBe('cancelled')
  })

  it('is undefined without a catalog rather than guessing', () => {
    expect(getTaskStatusCategory({ column: { status_key: 'done' } }, null)).toBeUndefined()
  })
})

describe('getTaskStatusLabel', () => {
  it('uses the admin-chosen label when a catalog is supplied', () => {
    expect(getTaskStatusLabel({ column: { status_key: 'review' } }, CATALOG)).toBe('In Review')
    expect(getTaskStatusLabel({ column: { status_key: 'icebox' } }, CATALOG)).toBe('Icebox')
  })

  it('renders the four seeded statuses identically with and without a catalog', () => {
    for (const key of ['to_do', 'in_progress', 'done', 'cancelled']) {
      const task = { column: { status_key: key } }
      expect(getTaskStatusLabel(task, CATALOG)).toBe(getTaskStatusLabel(task))
    }
  })
})

describe('bucketForCategory / isClosedCategory', () => {
  it('collapses the five categories into the three rendered buckets', () => {
    expect(bucketForCategory('backlog')).toBe('to_do')
    expect(bucketForCategory('planned')).toBe('to_do')
    expect(bucketForCategory('started')).toBe('in_progress')
    expect(bucketForCategory('completed')).toBe('done')
    expect(bucketForCategory('cancelled')).toBe('done')
  })

  it('agrees with the generated task_statuses.is_closed expression', () => {
    // Postgres computes `category IN ('completed','cancelled')`. These must not drift.
    for (const c of STATUS_CATEGORIES) {
      expect(isClosedCategory(c)).toBe(c === 'completed' || c === 'cancelled')
    }
  })

  it('covers every category exactly once, so a new one cannot be silently bucketed', () => {
    expect(STATUS_CATEGORIES).toHaveLength(5)
    expect(new Set(STATUS_CATEGORIES).size).toBe(5)
    for (const c of STATUS_CATEGORIES) expect(STATUS_CATEGORY_LABELS[c]).toBeTruthy()
  })
})

describe('isCancelledStatus / isOpenStatus / statusesForCreation', () => {
  it('recognises a second cancelled-category status the key comparison would miss', () => {
    const rejected = { key: 'rejected', category: 'cancelled' as StatusCategory }
    expect(isCancelledStatus(rejected)).toBe(true)
    // The rule this replaces - `s.key !== 'cancelled'` - lets this one through.
    expect(rejected.key !== 'cancelled').toBe(true)
  })

  it('still matches the literal key when no category is present', () => {
    expect(isCancelledStatus({ key: 'cancelled' })).toBe(true)
    expect(isCancelledStatus({ key: 'to_do' })).toBe(false)
  })

  it('keeps completed statuses creatable and drops only cancelled ones', () => {
    const creatable = statusesForCreation(CATALOG).map((s) => s.key)
    expect(creatable).toContain('done')
    expect(creatable).toContain('shipped')
    expect(creatable).not.toContain('cancelled')
    expect(creatable).not.toContain('rejected')
  })

  it('reports open/closed from the category', () => {
    expect(isOpenStatus({ key: 'blocked', category: 'started' })).toBe(true)
    expect(isOpenStatus({ key: 'icebox', category: 'backlog' })).toBe(true)
    expect(isOpenStatus({ key: 'shipped', category: 'completed' })).toBe(false)
    expect(isOpenStatus({ key: 'rejected', category: 'cancelled' })).toBe(false)
  })
})

describe('categoryForColumn', () => {
  it('reads through the 063 FK', () => {
    expect(categoryForColumn({ status_key: 'review' }, CATALOG)).toBe('started')
  })

  it('is undefined for a custom column with no linked status', () => {
    expect(categoryForColumn({ status_key: null }, CATALOG)).toBeUndefined()
    expect(categoryForColumn({}, CATALOG)).toBeUndefined()
  })
})
