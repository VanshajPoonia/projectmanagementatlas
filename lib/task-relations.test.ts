import { describe, it, expect } from 'vitest'
import {
  toCanonical,
  inverseRelation,
  groupRelations,
  blockingRelations,
  relationRejectionReason,
  isSymmetric,
  CANONICAL_RELATIONS,
  DISPLAY_RELATIONS,
  ACYCLIC_RELATIONS,
  RELATION_LABELS,
  RELATION_HINTS,
  type ExpandedRelation,
  type DisplayRelation,
} from './task-relations'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'

const rel = (over: Partial<ExpandedRelation> & { relation: DisplayRelation }): ExpandedRelation => ({
  id: over.id ?? 'r1',
  task_id: over.task_id ?? A,
  related_task_id: over.related_task_id ?? B,
  relation: over.relation,
  is_inverse: over.is_inverse ?? false,
})

describe('the relation vocabulary', () => {
  it('exposes seven relations built from four stored types', () => {
    expect(CANONICAL_RELATIONS).toHaveLength(4)
    expect(DISPLAY_RELATIONS).toHaveLength(7)
    // Every canonical type is also a display relation; the extra three are the inverses.
    for (const c of CANONICAL_RELATIONS) expect(DISPLAY_RELATIONS).toContain(c)
  })

  it('gives every relation a label and a hint', () => {
    for (const r of DISPLAY_RELATIONS) {
      expect(RELATION_LABELS[r]).toBeTruthy()
      expect(RELATION_HINTS[r]).toBeTruthy()
    }
  })

  it('is its own inverse twice over', () => {
    for (const r of DISPLAY_RELATIONS) {
      expect(inverseRelation(inverseRelation(r))).toBe(r)
    }
  })

  it('treats relates_to, and only relates_to, as symmetric', () => {
    expect(isSymmetric('relates_to')).toBe(true)
    expect(inverseRelation('relates_to')).toBe('relates_to')
    for (const r of DISPLAY_RELATIONS.filter((x) => x !== 'relates_to')) {
      expect(isSymmetric(r)).toBe(false)
      expect(inverseRelation(r)).not.toBe(r)
    }
  })

  it('marks the three directional types as needing acyclicity', () => {
    expect(ACYCLIC_RELATIONS.sort()).toEqual(['blocks', 'duplicates', 'precedes'])
    expect(ACYCLIC_RELATIONS).not.toContain('relates_to')
  })
})

describe('toCanonical - an inverse is stored by swapping the ends, not by a new type', () => {
  it('stores a forward relation as given', () => {
    expect(toCanonical(A, 'blocks', B)).toEqual({
      source_task_id: A, target_task_id: B, relation_type: 'blocks',
    })
  })

  it('stores "blocked by" as the other item blocking this one', () => {
    expect(toCanonical(A, 'blocked_by', B)).toEqual({
      source_task_id: B, target_task_id: A, relation_type: 'blocks',
    })
  })

  it('does the same for follows and duplicated_by', () => {
    expect(toCanonical(A, 'follows', B)).toEqual({
      source_task_id: B, target_task_id: A, relation_type: 'precedes',
    })
    expect(toCanonical(A, 'duplicated_by', B)).toEqual({
      source_task_id: B, target_task_id: A, relation_type: 'duplicates',
    })
  })

  it('only ever emits one of the four stored types', () => {
    for (const r of DISPLAY_RELATIONS) {
      expect(CANONICAL_RELATIONS).toContain(toCanonical(A, r, B).relation_type)
    }
  })

  it('makes a relation and its inverse produce the identical row', () => {
    // This is the property that stops blocks and blocked_by ever disagreeing: both are the
    // same row, so there is nothing to keep in step.
    expect(toCanonical(A, 'blocks', B)).toEqual(toCanonical(B, 'blocked_by', A))
    expect(toCanonical(A, 'precedes', B)).toEqual(toCanonical(B, 'follows', A))
    expect(toCanonical(A, 'duplicates', B)).toEqual(toCanonical(B, 'duplicated_by', A))
  })
})

describe('groupRelations', () => {
  it('puts blockers first - they are what stops work', () => {
    const groups = groupRelations([
      rel({ relation: 'relates_to', related_task_id: C }),
      rel({ relation: 'blocks', related_task_id: B }),
      rel({ relation: 'blocked_by', related_task_id: C }),
    ])
    expect(groups.map((g) => g.relation)).toEqual(['blocked_by', 'blocks', 'relates_to'])
  })

  it('omits empty groups so the panel does not list seven headings', () => {
    expect(groupRelations([rel({ relation: 'blocks' })]).map((g) => g.relation)).toEqual(['blocks'])
    expect(groupRelations([])).toEqual([])
    expect(groupRelations(null)).toEqual([])
  })

  it('keeps every row', () => {
    const rows = [
      rel({ id: '1', relation: 'blocks', related_task_id: B }),
      rel({ id: '2', relation: 'blocks', related_task_id: C }),
    ]
    expect(groupRelations(rows)[0].items).toHaveLength(2)
  })
})

describe('blockingRelations', () => {
  const rows = [
    rel({ id: '1', relation: 'blocked_by', related_task_id: B }),
    rel({ id: '2', relation: 'blocked_by', related_task_id: C }),
    rel({ id: '3', relation: 'blocks', related_task_id: C }),
    rel({ id: '4', relation: 'relates_to', related_task_id: B }),
  ]

  it('counts only open blockers', () => {
    // A completed blocker is not standing in the way of anything.
    const open = blockingRelations(rows, (id) => id === B)
    expect(open.map((r) => r.id)).toEqual(['1'])
  })

  it('ignores relations that are not blocked_by, including blocks in the other direction', () => {
    const all = blockingRelations(rows, () => true)
    expect(all.map((r) => r.id)).toEqual(['1', '2'])
  })

  it('reports nothing when every blocker is closed', () => {
    expect(blockingRelations(rows, () => false)).toEqual([])
  })
})

describe('relationRejectionReason', () => {
  it('refuses relating a work item to itself', () => {
    expect(relationRejectionReason(A, 'blocks', A, [])).toMatch(/itself/)
  })

  it('asks for a work item when none is chosen', () => {
    expect(relationRejectionReason(A, 'blocks', '', [])).toMatch(/Pick a work item/)
  })

  it('refuses a duplicate of a relation already present', () => {
    const existing = [rel({ relation: 'blocks', related_task_id: B })]
    expect(relationRejectionReason(A, 'blocks', B, existing)).toMatch(/already marked/)
  })

  it('recognises the duplicate through the inverse wording, because it is the same row', () => {
    // A shows "blocks B". Adding "B blocked_by A" from A's panel is the same stored row.
    const existing = [rel({ relation: 'blocked_by', related_task_id: B })]
    expect(relationRejectionReason(A, 'blocked_by', B, existing)).toMatch(/already marked/)
  })

  it('refuses the direct opposite of an existing relation', () => {
    const existing = [rel({ relation: 'blocks', related_task_id: B })]
    expect(relationRejectionReason(A, 'blocked_by', B, existing)).toMatch(/opposite/)
  })

  it('allows the same pair to hold two DIFFERENT relations', () => {
    const existing = [rel({ relation: 'blocks', related_task_id: B })]
    expect(relationRejectionReason(A, 'relates_to', B, existing)).toBeNull()
  })

  it('allows a fresh pair', () => {
    expect(relationRejectionReason(A, 'blocks', C, [rel({ relation: 'blocks', related_task_id: B })])).toBeNull()
  })

  it('does not try to predict a multi-step cycle', () => {
    // The client sees only the relations it is allowed to read. Guessing at a loop from a
    // partial graph would refuse valid relations and miss invalid ones; the trigger walks the
    // real graph. A -> B here is simply allowed, and the database decides.
    const existing = [rel({ relation: 'blocked_by', related_task_id: C })]
    expect(relationRejectionReason(A, 'blocks', B, existing)).toBeNull()
  })

  it('handles a missing existing list', () => {
    expect(relationRejectionReason(A, 'blocks', B, null)).toBeNull()
  })
})
