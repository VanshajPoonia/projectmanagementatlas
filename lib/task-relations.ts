// Work-item relations - the client's view of migration 115.
//
// Seven relations, four stored rows. The database keeps only the canonical direction and
// derives the inverse in `public.task_relations_expanded`; this module holds the vocabulary
// both ends share, so a screen never has to reason about which way a row happens to point.
//
// ⚠️ `task_links` is a DIFFERENT table - external URL bookmarks on a task, not relations
// between work items. Nothing here touches it.

/** What is actually stored. `relates_to` is symmetric and normalised to source < target. */
export type CanonicalRelation = 'blocks' | 'precedes' | 'duplicates' | 'relates_to'

/** What a task's own panel displays, including the derived inverses. */
export type DisplayRelation =
  | CanonicalRelation
  | 'blocked_by'
  | 'follows'
  | 'duplicated_by'

export const CANONICAL_RELATIONS: CanonicalRelation[] = ['blocks', 'precedes', 'duplicates', 'relates_to']

export const DISPLAY_RELATIONS: DisplayRelation[] = [
  'blocks', 'blocked_by', 'precedes', 'follows', 'duplicates', 'duplicated_by', 'relates_to',
]

/**
 * Every relation and its opposite. `relates_to` is its own inverse, which is exactly why the
 * database normalises the pair order - otherwise the same fact would be storable twice.
 */
const INVERSE: Record<DisplayRelation, DisplayRelation> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  precedes: 'follows',
  follows: 'precedes',
  duplicates: 'duplicated_by',
  duplicated_by: 'duplicates',
  relates_to: 'relates_to',
}

export function inverseRelation(relation: DisplayRelation): DisplayRelation {
  return INVERSE[relation]
}

/** Wording for a relation as read from the current work item outwards. */
export const RELATION_LABELS: Record<DisplayRelation, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  precedes: 'Precedes',
  follows: 'Follows',
  duplicates: 'Duplicate of',
  duplicated_by: 'Duplicated by',
  relates_to: 'Related to',
}

/** One line of explanation, shown where the relation is chosen. */
export const RELATION_HINTS: Record<DisplayRelation, string> = {
  blocks: 'This work item must finish before the other one can proceed.',
  blocked_by: 'The other work item must finish before this one can proceed.',
  precedes: 'This one is scheduled ahead of the other, without strictly blocking it.',
  follows: 'This one is scheduled after the other, without being strictly blocked.',
  duplicates: 'This one describes the same work as the other; the other is the original.',
  duplicated_by: 'Another work item describes the same work as this one.',
  relates_to: 'The two are connected, with no ordering implied.',
}

/**
 * The relations a user can pick from when adding one. All seven are offered: picking an
 * inverse simply stores the canonical row the other way round (see `toCanonical`), which is
 * how "this is blocked by that" is expressible without a second table.
 */
export const SELECTABLE_RELATIONS = DISPLAY_RELATIONS

/** Directional relations must stay acyclic; the database refuses a loop in any of these. */
export const ACYCLIC_RELATIONS: CanonicalRelation[] = ['blocks', 'precedes', 'duplicates']

export function isSymmetric(relation: DisplayRelation): boolean {
  return relation === 'relates_to'
}

/**
 * Turn "this item <relation> that item" into the row the database stores.
 *
 * An inverse choice is stored by swapping the two ends, never by inventing a second relation
 * type - which is what keeps blocks/blocked_by from ever disagreeing.
 */
export function toCanonical(
  thisTaskId: string,
  relation: DisplayRelation,
  otherTaskId: string,
): { source_task_id: string; target_task_id: string; relation_type: CanonicalRelation } {
  switch (relation) {
    case 'blocked_by':
      return { source_task_id: otherTaskId, target_task_id: thisTaskId, relation_type: 'blocks' }
    case 'follows':
      return { source_task_id: otherTaskId, target_task_id: thisTaskId, relation_type: 'precedes' }
    case 'duplicated_by':
      return { source_task_id: otherTaskId, target_task_id: thisTaskId, relation_type: 'duplicates' }
    default:
      return { source_task_id: thisTaskId, target_task_id: otherTaskId, relation_type: relation as CanonicalRelation }
  }
}

/** A row as it comes back from `task_relations_expanded`. */
export interface ExpandedRelation {
  id: string
  task_id: string
  related_task_id: string
  relation: DisplayRelation
  is_inverse: boolean
}

export interface RelationGroup {
  relation: DisplayRelation
  label: string
  items: ExpandedRelation[]
}

/**
 * Group a task's relations for display, in a fixed order so the panel does not reshuffle as
 * relations are added. Blockers first: they are the ones that stop work.
 */
export function groupRelations(rows: ExpandedRelation[] | null | undefined): RelationGroup[] {
  const order: DisplayRelation[] = [
    'blocked_by', 'blocks', 'follows', 'precedes', 'duplicates', 'duplicated_by', 'relates_to',
  ]
  return order
    .map((relation) => ({
      relation,
      label: RELATION_LABELS[relation],
      items: (rows ?? []).filter((r) => r.relation === relation),
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * Is this work item blocked right now?
 *
 * Only `blocked_by` counts, and only while the blocker is still open - a blocker that is
 * completed or cancelled is not standing in the way of anything. `isOpen` is supplied by the
 * caller because openness comes from the status CATEGORY (migration 112) and this module has
 * no catalog; passing it in keeps the one place that decides open/closed in lib/task-status.ts.
 */
export function blockingRelations(
  rows: ExpandedRelation[] | null | undefined,
  isOpen: (taskId: string) => boolean,
): ExpandedRelation[] {
  return (rows ?? []).filter((r) => r.relation === 'blocked_by' && isOpen(r.related_task_id))
}

/**
 * Why a relation cannot be added, or null when it can.
 *
 * Mirrors what the database refuses, and no more. It cannot see the whole graph, so it does
 * NOT attempt to predict a multi-step cycle - the trigger walks the real graph including rows
 * this client may not be allowed to read, and reporting "that would make a loop" from a
 * partial view would be wrong in both directions.
 */
export function relationRejectionReason(
  thisTaskId: string,
  relation: DisplayRelation,
  otherTaskId: string,
  existing: ExpandedRelation[] | null | undefined,
): string | null {
  if (!otherTaskId) return 'Pick a work item.'
  if (otherTaskId === thisTaskId) return 'A work item cannot be related to itself.'

  const canonical = toCanonical(thisTaskId, relation, otherTaskId)

  const already = (existing ?? []).some((r) => {
    if (r.related_task_id !== otherTaskId) return false
    const other = toCanonical(thisTaskId, r.relation, otherTaskId)
    return other.relation_type === canonical.relation_type
      && other.source_task_id === canonical.source_task_id
      && other.target_task_id === canonical.target_task_id
  })
  if (already) return `These two are already marked "${RELATION_LABELS[relation]}".`

  // The one loop this client CAN see with certainty: the direct opposite of what is proposed.
  const opposite = (existing ?? []).some(
    (r) => r.related_task_id === otherTaskId && r.relation === inverseRelation(relation),
  )
  if (opposite && !isSymmetric(relation)) {
    return `These two are already marked "${RELATION_LABELS[inverseRelation(relation)]}", which is the opposite.`
  }

  return null
}
