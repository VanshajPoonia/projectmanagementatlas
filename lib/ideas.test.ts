import { describe, it, expect } from 'vitest'
import {
  IDEA_STATES, IDEA_STATE_LABELS, IDEA_STATE_HELP, isIdeaOpen, isIdeaConverted,
  requiresRejectionReason, ideasByState, impactEffortMatrix, explainMatrix, conversionTypes,
  MATRIX_CELLS, type IdeaRow,
} from './ideas'

const idea = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: over.id ?? 'i1', title: over.title ?? 'An idea', state: over.state ?? 'captured', ...over,
})

describe('the pipeline states match migration 130 exactly', () => {
  it('has all seven, in order', () => {
    expect(IDEA_STATES).toEqual(['captured', 'reviewing', 'researching', 'validated', 'planned', 'rejected', 'archived'])
  })

  it('keeps rejected and parked as different endings, because the schema does', () => {
    expect(IDEA_STATE_LABELS.rejected).toBe('Rejected')
    expect(IDEA_STATE_LABELS.archived).toBe('Parked')
    expect(IDEA_STATE_HELP.archived).toContain('not a no')
    expect(IDEA_STATE_HELP.rejected).toContain('reason recorded')
  })

  it('every state explains itself, so no column on the board is unlabelled', () => {
    for (const state of IDEA_STATES) {
      expect(IDEA_STATE_HELP[state].length).toBeGreaterThan(20)
    }
  })
})

describe('rejection needs a reason, mirroring the trigger', () => {
  it('is required when moving into rejected', () => {
    expect(requiresRejectionReason('researching', 'rejected')).toBe(true)
  })

  it('is not required for any other move', () => {
    expect(requiresRejectionReason('captured', 'archived')).toBe(false)
    expect(requiresRejectionReason('validated', 'planned')).toBe(false)
  })

  it('is not required for an update that leaves it rejected', () => {
    expect(requiresRejectionReason('rejected', 'rejected')).toBe(false)
  })
})

describe('conversion', () => {
  it('reads the timestamp, not the pointers - both are ON DELETE SET NULL', () => {
    // A converted idea whose board was later deleted must not look untouched.
    expect(isIdeaConverted(idea({ converted_at: '2026-09-01T00:00:00Z', converted_board_id: null }))).toBe(true)
    expect(isIdeaConverted(idea({}))).toBe(false)
  })

  it('offers whatever work item types are active, so activating one is a config change', () => {
    const types = [
      { key: 'task', name: 'Task', is_active: true },
      { key: 'subtask', name: 'Subtask', is_active: true },
      { key: 'feature', name: 'Feature', is_active: false },
    ]
    expect(conversionTypes(types).map((t) => t.key)).toEqual(['task'])
    // The day a super admin activates `feature` it appears here with no code change - 113
    // seeded eleven types and a hardcoded list would ignore nine of them forever.
    types[2].is_active = true
    expect(conversionTypes(types).map((t) => t.key)).toEqual(['task', 'feature'])
  })

  it('never offers subtask, which cannot stand on its own', () => {
    expect(conversionTypes([{ key: 'subtask', name: 'Subtask', is_active: true }])).toEqual([])
  })
})

describe('grouping by state', () => {
  it('gives every state a bucket, including the empty ones', () => {
    const grouped = ideasByState([])
    expect(Object.keys(grouped).sort()).toEqual([...IDEA_STATES].sort())
  })

  it('keeps an idea whose state this build does not know rather than dropping it', () => {
    const grouped = ideasByState([idea({ id: 'x', state: 'something_new' as IdeaRow['state'] })])
    const everywhere = IDEA_STATES.flatMap((s) => grouped[s].map((i) => i.id))
    expect(everywhere).toContain('x')
  })

  it('orders by position then newest first', () => {
    const grouped = ideasByState([
      idea({ id: 'a', position: 2, created_at: '2026-01-01' }),
      idea({ id: 'b', position: 1, created_at: '2026-01-01' }),
    ])
    expect(grouped.captured.map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('impact / effort reads the ideas and stores nothing', () => {
  it('places each idea in exactly one quadrant', () => {
    const m = impactEffortMatrix([
      idea({ id: 'quick', impact: 'high', effort: 'low' }),
      idea({ id: 'bet', impact: 'high', effort: 'high' }),
      idea({ id: 'fill', impact: 'low', effort: 'low' }),
      idea({ id: 'sink', impact: 'low', effort: 'high' }),
    ])
    expect(m.cells.quick_win.map((i) => i.id)).toEqual(['quick'])
    expect(m.cells.big_bet.map((i) => i.id)).toEqual(['bet'])
    expect(m.cells.fill_in.map((i) => i.id)).toEqual(['fill'])
    expect(m.cells.money_pit.map((i) => i.id)).toEqual(['sink'])
  })

  it('never places an unscored idea in a quadrant it was not scored into', () => {
    const m = impactEffortMatrix([
      idea({ id: 'no-effort', impact: 'high' }),
      idea({ id: 'no-impact', effort: 'low' }),
      idea({ id: 'neither' }),
    ])
    const placed = MATRIX_CELLS.flatMap((c) => m.cells[c].map((i) => i.id))
    expect(placed).toEqual([])
    expect(m.unscored.map((i) => i.id)).toEqual(['no-effort', 'no-impact', 'neither'])
  })

  it('states how it treats medium rather than leaving it to be guessed', () => {
    const m = impactEffortMatrix([idea({ id: 'mid', impact: 'medium', effort: 'medium' })])
    expect(m.cells.quick_win.map((i) => i.id)).toEqual(['mid'])
    expect(m.formula).toContain('medium counts as high')
  })

  it('names its exclusions with a real count', () => {
    const m = impactEffortMatrix([idea({ id: 'a' }), idea({ id: 'b', impact: 'high', effort: 'low' })])
    expect(explainMatrix(m)).toContain('1 idea placed')
    expect(m.excludes).toContain('1 of them')
  })
})

describe('open ideas', () => {
  it('counts the four states still moving forward', () => {
    expect(isIdeaOpen(idea({ state: 'researching' }))).toBe(true)
    expect(isIdeaOpen(idea({ state: 'planned' }))).toBe(false)
    expect(isIdeaOpen(idea({ state: 'rejected' }))).toBe(false)
    expect(isIdeaOpen(idea({ state: 'archived' }))).toBe(false)
  })
})
