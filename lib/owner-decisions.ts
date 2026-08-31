// Owner decisions: the pure shape and ordering, with no React and no Supabase.
//
// Split out for the same reason lib/agile.ts is: the sorting rule and the "what does this status
// mean" wording are the parts worth testing, and they are worth testing precisely because a
// screen that shows a decision under the wrong heading is worse than one that shows nothing.

export type DecisionStatus = 'open' | 'resolved' | 'dismissed'

export interface OwnerDecision {
  id: string
  title: string
  summary: string
  detail: string | null
  recommendation: string | null
  status: DecisionStatus
  resolution_note: string | null
  resolved_by: string | null
  resolved_at: string | null
  position: number
  created_at: string
}

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  open: 'Waiting on you',
  resolved: 'Decided',
  dismissed: 'Not doing',
}

/**
 * What each status actually means, in the words of somebody deciding rather than of the schema.
 *
 * ⚠️ `dismissed` is deliberately NOT "rejected". A decision can stop being worth making without
 * anybody having judged it badly - the situation changes, or it turns out not to matter - and a
 * label that implies a verdict makes people leave things open rather than close them honestly.
 */
export const DECISION_STATUS_HELP: Record<DecisionStatus, string> = {
  open: 'Nobody has decided this yet. It is here so it does not get lost.',
  resolved: 'A call was made. The note says what and why.',
  dismissed: 'Deliberately not being pursued. Reopen it if that changes.',
}

/** Open first, then by the order somebody gave them, then oldest first as a stable tie-break. */
export function sortDecisions(rows: OwnerDecision[]): OwnerDecision[] {
  const rank = (d: OwnerDecision) => (d.status === 'open' ? 0 : 1)
  return [...rows].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.position !== b.position) return a.position - b.position
    return a.created_at.localeCompare(b.created_at)
  })
}

export function openDecisions(rows: OwnerDecision[]): OwnerDecision[] {
  return sortDecisions(rows).filter((d) => d.status === 'open')
}

export function closedDecisions(rows: OwnerDecision[]): OwnerDecision[] {
  return sortDecisions(rows).filter((d) => d.status !== 'open')
}

/**
 * The database refuses a closure with no note (migration 128's trigger). Mirroring that here
 * lets the dialog say so before the round-trip, but the trigger stays the authority - a rule
 * enforced only in a dialog is not enforced, which is the defect this codebase keeps repeating.
 */
export function closureRejectionReason(note: string): string | null {
  if (!note.trim()) return 'Say what was decided. Six months from now this note is the only record of why.'
  if (note.length > 4000) return 'That note is too long. Keep it to the decision and the reason.'
  return null
}

export function decisionRejectionReason(input: { title: string; summary: string }): string | null {
  if (!input.title.trim()) return 'Give the decision a title.'
  if (input.title.length > 200) return 'That title is too long.'
  if (!input.summary.trim()) return 'Add one sentence saying what is being decided.'
  if (input.summary.length > 500) return 'That summary is too long. The detail field is for the rest.'
  return null
}
