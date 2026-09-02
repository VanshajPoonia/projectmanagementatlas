// The idea pipeline, and the impact/effort view that reads it.
//
// Prompt H lists seven states and calls them optional, so nothing here enforces an order: an
// idea may go straight from Captured to Validated, and the pipeline is a way of SEEING where
// things are rather than a workflow that blocks. The one rule the database does enforce
// (migration 130) is that a rejection carries a reason, because six months later that reason
// is the only thing standing between the team and re-proposing the same idea.
//
// ⚠️ THE IMPACT/EFFORT MATRIX HAS NO SCHEMA. Prompt H's strategy section lists it as a
// candidate canvas and this module answers it by GROUPING THE IDEAS THAT ALREADY EXIST, since
// 130 stores `impact` and `effort` on every idea. A second table holding the same two
// judgements would be two sources of truth for one fact - the defect this codebase spends
// most of its time unpicking. The matrix is a lens, not a place things live.
//
// No React, no Supabase.

export type IdeaState =
  | 'captured' | 'reviewing' | 'researching' | 'validated' | 'planned' | 'rejected' | 'archived'

export type IdeaScale = 'high' | 'medium' | 'low'

/** Pipeline order, used for the board columns. Matches migration 130's CHECK exactly. */
export const IDEA_STATES: IdeaState[] = [
  'captured', 'reviewing', 'researching', 'validated', 'planned', 'rejected', 'archived',
]

export const IDEA_STATE_LABELS: Record<IdeaState, string> = {
  captured: 'Captured',
  reviewing: 'Reviewing',
  researching: 'Researching',
  validated: 'Validated',
  planned: 'Planned',
  rejected: 'Rejected',
  archived: 'Parked',
}

/**
 * ⚠️ `archived` reads as "Parked", deliberately. Prompt H asks for both `rejected` and
 * `archived`, and the difference is the whole reason there are two: rejected is a decision
 * with a reason attached, parked is "not now, not a no". Labelling both as some flavour of
 * "closed" would lose the distinction the schema was built to keep.
 */
export const IDEA_STATE_HELP: Record<IdeaState, string> = {
  captured: 'Written down so it is not lost. Nobody has looked at it yet.',
  reviewing: 'Someone is deciding whether it is worth investigating.',
  researching: 'Being looked into - evidence is being gathered on the idea.',
  validated: 'The evidence supports it. Ready to become real work.',
  planned: 'It became a project or a work item. The idea stays here with its reasoning.',
  rejected: 'Decided against, with the reason recorded. Kept so the same idea is not raised again from scratch.',
  archived: 'Not now, but not a no. Parked with nothing decided against it.',
}

/** The states an idea can still move forward from. Internal: reached through isIdeaOpen(). */
const IDEA_OPEN_STATES: IdeaState[] = ['captured', 'reviewing', 'researching', 'validated']

export const IDEA_SCALE_LABELS: Record<IdeaScale, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export interface IdeaRow {
  id: string
  title: string
  problem?: string | null
  target_customer?: string | null
  evidence?: string | null
  expected_value?: string | null
  impact?: IdeaScale | null
  effort?: IdeaScale | null
  confidence?: IdeaScale | null
  state: IdeaState
  converted_board_id?: string | null
  converted_task_id?: string | null
  converted_at?: string | null
  position?: number | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface IdeaEventRow {
  id: string
  idea_id: string
  kind: 'captured' | 'state_change' | 'converted'
  from_state?: string | null
  to_state?: string | null
  note?: string | null
  created_by?: string | null
  created_at: string
}

export interface IdeaNoteRow {
  id: string
  idea_id: string
  body: string
  created_by?: string | null
  created_at: string
  updated_at?: string | null
}

export function isIdeaOpen(idea: IdeaRow): boolean {
  return IDEA_OPEN_STATES.includes(idea.state)
}

export function isIdeaConverted(idea: IdeaRow): boolean {
  // The timestamp, never the pointers: both are ON DELETE SET NULL, so a deleted board must
  // not make a converted idea look untouched (migration 130's own note).
  return Boolean(idea.converted_at)
}

/**
 * Mirrors migration 130's trigger. Named as a mirror, per this repo's rule that a client-side
 * rule must say which server rule it reflects - a UI stricter than its policy silently removes
 * an ability, and a looser one produces a refusal the user cannot explain.
 */
export function requiresRejectionReason(from: IdeaState, to: IdeaState): boolean {
  return to === 'rejected' && from !== 'rejected'
}

export function ideasByState(ideas: IdeaRow[]): Record<IdeaState, IdeaRow[]> {
  const out = {} as Record<IdeaState, IdeaRow[]>
  for (const state of IDEA_STATES) out[state] = []
  for (const idea of ideas) {
    // An unknown state means the database moved ahead of this build. Dropping the row would
    // hide real work, so it lands in the first column with its own label intact.
    const bucket = out[idea.state] ?? out.captured
    bucket.push(idea)
  }
  for (const state of IDEA_STATES) {
    out[state].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }
  return out
}

// ---------------------------------------------------------------------------------------
// Impact / effort
// ---------------------------------------------------------------------------------------

export type MatrixCell = 'quick_win' | 'big_bet' | 'fill_in' | 'money_pit'

export const MATRIX_CELLS: MatrixCell[] = ['quick_win', 'big_bet', 'fill_in', 'money_pit']

export const MATRIX_LABELS: Record<MatrixCell, string> = {
  quick_win: 'Quick wins',
  big_bet: 'Big bets',
  fill_in: 'Fill-ins',
  money_pit: 'Time sinks',
}

export const MATRIX_HELP: Record<MatrixCell, string> = {
  quick_win: 'High impact, low effort. Do these first.',
  big_bet: 'High impact, high effort. Worth planning properly rather than squeezing in.',
  fill_in: 'Low impact, low effort. Cheap enough to do when there is a gap.',
  money_pit: 'Low impact, high effort. Say no, or find a cheaper way to get the same result.',
}

export interface ImpactEffortMatrix {
  cells: Record<MatrixCell, IdeaRow[]>
  /**
   * Ideas that carry no impact or no effort judgement. Reported as their own number and never
   * placed in a cell: putting an unscored idea in "Time sinks" because two fields were blank
   * is an accusation the data does not support. Same rule as an unestimated sprint item.
   */
  unscored: IdeaRow[]
  definition: string
  formula: string
  excludes: string
}

/**
 * ⚠️ `medium` counts as HIGH impact and LOW effort - the optimistic reading in both
 * directions - and that choice is stated rather than buried, because a two-by-two grid has to
 * put a three-valued scale somewhere and every option is arguable. The alternative, a
 * three-by-three, produces nine cells nobody has a name for.
 */
export function impactEffortMatrix(ideas: IdeaRow[]): ImpactEffortMatrix {
  const cells: Record<MatrixCell, IdeaRow[]> = { quick_win: [], big_bet: [], fill_in: [], money_pit: [] }
  const unscored: IdeaRow[] = []

  for (const idea of ideas) {
    if (!idea.impact || !idea.effort) {
      unscored.push(idea)
      continue
    }
    const highImpact = idea.impact === 'high' || idea.impact === 'medium'
    const highEffort = idea.effort === 'high'
    if (highImpact && !highEffort) cells.quick_win.push(idea)
    else if (highImpact && highEffort) cells.big_bet.push(idea)
    else if (!highImpact && !highEffort) cells.fill_in.push(idea)
    else cells.money_pit.push(idea)
  }

  return {
    cells,
    unscored,
    definition: 'Where each idea sits on impact against effort, so the cheap valuable ones are visible next to the expensive ones.',
    formula: 'Impact high or medium counts as high; effort high counts as high. Everything else counts as low.',
    excludes: `Ideas with no impact or no effort recorded - ${unscored.length} of them - which are listed separately rather than placed in a quadrant they were never scored into.`,
  }
}

/** The footnote, built from the value rather than written beside it. */
export function explainMatrix(matrix: ImpactEffortMatrix): string {
  const placed = MATRIX_CELLS.reduce((sum, cell) => sum + matrix.cells[cell].length, 0)
  return `${matrix.definition} ${matrix.formula} ${placed} idea${placed === 1 ? '' : 's'} placed. Excludes: ${matrix.excludes}`
}

/**
 * What a validated idea may become. Derived from the live work-item-type registry rather than
 * hardcoded, so activating `feature` in Super Admin makes it an option here with no code
 * change - 113 seeded eleven types and only two are active, and a hardcoded list would
 * silently ignore the other nine forever.
 */
export interface ConversionType {
  key: string
  label: string
}

export function conversionTypes(
  types: { key: string; name: string; is_active?: boolean | null; can_have_children?: boolean | null }[],
): ConversionType[] {
  return types
    .filter((t) => t.is_active !== false && t.key !== 'subtask')
    .map((t) => ({ key: t.key, label: t.name }))
}
