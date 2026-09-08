import { describe, it, expect } from 'vitest'
import { MILESTONE_STATE_CASES, MILESTONE_NOTE_CASES } from './milestones.cases.mjs'
import { noteAfterTransition, stateChangeRejection, type MilestoneState } from './milestones'

/**
 * The TypeScript half of the milestone state gate.
 *
 * The SAME cases are run against the real trigger from migration 133 by
 * scripts/check-milestones.mjs, over real RLS. Neither side is the reference: this half decides
 * what a person is allowed to click, the SQL half decides what the database keeps, and the
 * whole value is that they cannot drift. 114's custom-field validator and 116's recurrence date
 * maths both ship exactly this pairing.
 *
 * ⚠️ If you change a case here, the database side has to agree or `pnpm check:milestones` goes
 * red. That is the point, and it was confirmed by flipping one case and watching BOTH sides
 * fail rather than trusting the arrangement to be meaningful.
 */
describe('state transitions agree with the trigger in migration 133', () => {
  for (const testCase of MILESTONE_STATE_CASES) {
    it(`${testCase.name}: ${testCase.accepted ? 'accepted' : 'refused'}`, () => {
      const rejection = stateChangeRejection(
        testCase.from as MilestoneState,
        testCase.to as MilestoneState,
        testCase.note,
      )
      if (testCase.accepted) {
        expect(rejection).toBeNull()
      } else {
        expect(rejection).not.toBeNull()
        // The message has to be usable, not just present. A refusal a person cannot act on is
        // the same as no explanation at all.
        expect(rejection).toContain('reason')
      }
    })
  }

  it('refuses a state that is not a milestone state at all', () => {
    expect(stateChangeRejection('open', 'finished' as MilestoneState, 'x')).not.toBeNull()
  })
})

describe('the note the trigger keeps is the note the dialog keeps', () => {
  for (const testCase of MILESTONE_NOTE_CASES) {
    it(testCase.name, () => {
      const kept = noteAfterTransition(testCase.to as MilestoneState, testCase.note)
      expect(kept === null).toBe(!testCase.keptNote)
    })
  }
})
