// State-transition cases for milestones, shared by two checkers that must not disagree.
//
// The same list is run by:
//   * lib/milestones.parity.test.ts - against the TypeScript mirror (`stateChangeRejection`),
//     which is what disables the Save button in the dialog.
//   * scripts/check-milestones.mjs   - against the REAL trigger in migration 133, over real RLS.
//
// Neither side is the reference. The TypeScript half decides what a person is allowed to click;
// the SQL half decides what the database keeps. A dialog that refuses what the database accepts
// takes an ability away from somebody with no way to tell that from a bug, and a dialog that
// accepts what the database refuses produces an error nobody could have predicted. 114 and 116
// both ship a parity file for exactly this reason.
//
// `.mjs` so a plain node script can import it without a TypeScript step.

/** @type {{ name: string, from: string, to: string, note: string|null, accepted: boolean }[]} */
export const MILESTONE_STATE_CASES = [
  // Reason required, in both directions and from every starting state.
  { name: 'missed with no note',              from: 'open',      to: 'missed',    note: null,  accepted: false },
  { name: 'missed with a blank note',         from: 'open',      to: 'missed',    note: '   ', accepted: false },
  { name: 'missed with a reason',             from: 'open',      to: 'missed',    note: 'permit expired', accepted: true },
  { name: 'cancelled with no note',           from: 'open',      to: 'cancelled', note: null,  accepted: false },
  { name: 'cancelled with a blank note',      from: 'open',      to: 'cancelled', note: '\t\n', accepted: false },
  { name: 'cancelled with a reason',          from: 'open',      to: 'cancelled', note: 'client pulled the scope', accepted: true },
  { name: 'missed from reached, no note',     from: 'reached',   to: 'missed',    note: null,  accepted: false },
  { name: 'cancelled from missed, no note',   from: 'missed',    to: 'cancelled', note: null,  accepted: false },

  // Reaching and reopening never need one, and must not be blocked by asking for one.
  { name: 'reached with no note',             from: 'open',      to: 'reached',   note: null,  accepted: true },
  { name: 'reached with a note anyway',       from: 'open',      to: 'reached',   note: 'shipped early', accepted: true },
  { name: 'reopened with no note',            from: 'missed',    to: 'open',      note: null,  accepted: true },
  { name: 'reopened from cancelled',          from: 'cancelled', to: 'open',      note: null,  accepted: true },
  { name: 'reopened from reached',            from: 'reached',   to: 'open',      note: null,  accepted: true },

  // A no-op is not a transition and must never demand a reason for a state already recorded.
  { name: 'missed staying missed, no note',   from: 'missed',    to: 'missed',    note: null,  accepted: true },
  { name: 'open staying open',                from: 'open',      to: 'open',      note: null,  accepted: true },
]

/**
 * Cases for the note that survives a transition. The trigger blanks the carrier on every path
 * out, which is 104's lesson: an early RETURN that skipped the blanking left a stale reason to
 * be stamped onto the NEXT decision nobody had supplied it for.
 *
 * @type {{ name: string, to: string, note: string|null, keptNote: boolean }[]}
 */
export const MILESTONE_NOTE_CASES = [
  { name: 'a missed milestone keeps its reason',    to: 'missed',    note: 'permit expired', keptNote: true },
  { name: 'a cancelled milestone keeps its reason', to: 'cancelled', note: 'scope pulled',   keptNote: true },
  { name: 'reaching one drops any reason',          to: 'reached',   note: 'ignore me',      keptNote: false },
  { name: 'reopening one drops any reason',         to: 'open',      note: 'ignore me',      keptNote: false },
]
