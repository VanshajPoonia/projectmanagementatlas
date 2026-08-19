// Telling an RLS refusal apart from a successful write.
//
// PostgREST does not treat a zero-row UPDATE or DELETE as an error. Under RLS those
// simply match nothing and report success, so `const { error } = await supabase.update(…)`
// is not a check - it only catches malformed requests and constraint violations, never a
// policy that declined. This is the single most repeated defect in this codebase: it is
// why board membership edits reported success while changing nothing (lib/board-membership.ts),
// and why a task card announced a saved title that the database had refused.
//
// The fix is always the same: ask for the rows back and count them. This module exists so
// the *interpretation* of that count lives in one tested place rather than being
// re-derived, subtly differently, at every call site.
//
// ⚠️ THE TRAP THAT MAKES A BARE COUNT WRONG
//
// `RETURNING` is filtered by the table's SELECT policy applied to the **new** row. So a
// write that legitimately succeeds can still hand back zero rows, if it made the row
// invisible to the person who wrote it. On `tasks` that is not hypothetical:
// `private.can_view_task` keys off `visibility` and assignment, so setting
// `visibility='assigned'` while removing yourself from the assignees is a successful write
// that returns nothing. Reporting that as "refused" would be a new lie replacing the old
// one.
//
// `classifyWrite` therefore treats an empty result as *ambiguous* and resolves it with a
// caller-supplied probe: if the row is still readable, the write was genuinely refused
// (a readable row would have come back); if it is not, the write may well have landed and
// simply moved out of view. Call sites whose update cannot affect visibility - a title, a
// priority, a due date - pass no probe and get the cheap, unambiguous answer.

export type WriteOutcome =
  /** The write landed and we saw the row. */
  | { kind: 'ok' }
  /** PostgREST returned an actual error (constraint, network, malformed request). */
  | { kind: 'error'; message: string }
  /** Zero rows and the row is still readable: a policy declined this write. */
  | { kind: 'refused' }
  /**
   * Zero rows and the row is no longer readable by this caller. The write probably landed
   * and took the row out of their view. Never report this as a failure - the honest thing
   * is to say the item is no longer visible, not that nothing happened.
   */
  | { kind: 'invisible' }

/** The shape every supabase-js write returns once `.select()` has been chained onto it. */
export interface WriteResult {
  data: unknown[] | null
  error: { message: string } | null
}

export interface ClassifyOptions {
  /**
   * How many rows this write was supposed to affect. Defaults to 1. A write targeting
   * several ids should pass their count, because a *partial* refusal is still a refusal
   * and silently succeeding on some rows is the worst of the three outcomes.
   */
  expected?: number
  /**
   * Optional probe, used only when zero rows came back. Resolve true when the target row
   * is still readable by this caller. Supply it whenever the write could change the row's
   * own visibility; omit it when it cannot.
   */
  stillReadable?: () => Promise<boolean>
}

export async function classifyWrite(
  result: WriteResult,
  options: ClassifyOptions = {},
): Promise<WriteOutcome> {
  const { expected = 1, stillReadable } = options

  if (result.error) return { kind: 'error', message: result.error.message }

  const returned = result.data?.length ?? 0
  if (returned >= expected) return { kind: 'ok' }

  // Some rows came back but not all of them: a policy filtered part of the set. There is
  // no ambiguity to resolve here - a partial result cannot be explained by the whole row
  // going out of view - so it is a refusal regardless of any probe.
  if (returned > 0) return { kind: 'refused' }

  if (!stillReadable) return { kind: 'refused' }
  return (await stillReadable()) ? { kind: 'refused' } : { kind: 'invisible' }
}

/**
 * The sentence to show the user, or null when there is nothing to say.
 *
 * Deliberately free of mechanism: "your role changed" is a guess, and naming policies or
 * tables in a toast tells the wrong person something useful. What the user needs is
 * whether their change survived and whether to try again.
 */
export function writeFailureMessage(
  outcome: WriteOutcome,
  subject = 'change',
): { title: string; description: string } | null {
  switch (outcome.kind) {
    case 'ok':
      return null
    case 'error':
      return { title: `Could not save that ${subject}`, description: outcome.message }
    case 'refused':
      return {
        title: `That ${subject} was not saved`,
        description:
          'You no longer have permission to make this change here. Reload the page to see the current state.',
      }
    case 'invisible':
      return {
        title: `Saved, but this is no longer visible to you`,
        description: 'Your change went through and moved this item out of your view.',
      }
  }
}

/** True when the caller should treat the outcome as "the change is in the database". */
export function didWrite(outcome: WriteOutcome): boolean {
  return outcome.kind === 'ok' || outcome.kind === 'invisible'
}
