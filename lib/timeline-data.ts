// Every database call milestones and the timeline make, in one place.
//
// Every write asks for its rows back and classifies the count, because an RLS refusal returns
// zero rows and NO error - this repo's single most repeated defect (lib/rls-write.ts).
//
// ⚠️ Two writes here CAN change a row's own visibility and therefore pass a `stillReadable`
// probe; the rest cannot and deliberately do not. Setting `owner_id` is the interesting case:
// migration 133's owner-update policy is `owner_id = auth.uid()`, so an owner handing a
// milestone to somebody else writes a row they can no longer UPDATE. Reporting that as "not
// saved" would send them to redo a change that is already in the database - exactly the case
// lib/rls-write.ts was written for.
//
// Not a React module: app/views/page.tsx calls the loaders from a Server Component, so nothing
// here may import a hook. That is the mistake lib/module-registry.ts exists to have fixed once.

import { classifyWrite, type WriteOutcome } from './rls-write'
import { dueDateForStorage } from './calendar-grid'
import type { MilestoneRow, MilestoneState, MilestoneTaskRow } from './milestones'

type Client = any

export interface TimelineWrite {
  outcome: WriteOutcome
}

const MILESTONE_COLUMNS =
  'id, board_id, title, description, owner_id, created_by, due_date, state, state_note, ' +
  'state_changed_at, state_changed_by, reached_at, created_at, updated_at'

const MILESTONE_TASK_COLUMNS = 'milestone_id, task_id, added_by, added_at'

export interface MilestoneDraft {
  board_id: string
  title: string
  description?: string | null
  owner_id?: string | null
  /** A calendar day. Stored as a real DATE, so it is passed through untouched. */
  due_date: string
}

/* ── Reads ─────────────────────────────────────────────────────────────────────────── */

/**
 * Milestones for a set of boards, or every one the caller can see when `boardIds` is empty.
 *
 * ⚠️ An empty result does not mean "this project has no milestones" - `milestones` is one of
 * the tables RLS can return a partial list from, and a private board's milestones are simply
 * absent for a non-member. Nothing downstream treats emptiness as a fact about the world; the
 * timeline says "no milestones on the boards in view" rather than "none exist".
 */
export async function loadMilestones(
  supabase: Client,
  boardIds: string[] = [],
): Promise<MilestoneRow[]> {
  let query = supabase.from('milestones').select(MILESTONE_COLUMNS).order('due_date')
  if (boardIds.length > 0) query = query.in('board_id', boardIds)
  const { data } = await query
  return (data ?? []) as MilestoneRow[]
}

export async function loadMilestoneTasks(
  supabase: Client,
  milestoneIds: string[],
): Promise<MilestoneTaskRow[]> {
  if (milestoneIds.length === 0) return []
  const { data } = await supabase
    .from('milestone_tasks')
    .select(MILESTONE_TASK_COLUMNS)
    .in('milestone_id', milestoneIds)
  return (data ?? []) as MilestoneTaskRow[]
}

/**
 * The scheduling relations between a set of tasks.
 *
 * ⚠️ Reads `task_relations_expanded` (115), which is `security_invoker`, so it returns only
 * relations whose BOTH ends the caller can see. Only `blocks` and `precedes` come back: those
 * are the two that constrain time. `duplicates` and `relates_to` say nothing about order, and
 * treating them as constraints would produce schedule warnings nobody could resolve.
 */
export async function loadSchedulingRelations(
  supabase: Client,
  taskIds: string[],
): Promise<{ sourceId: string; targetId: string; kind: 'blocks' | 'precedes' }[]> {
  if (taskIds.length === 0) return []

  // ⚠️ The columns are `task_id` / `related_task_id`, NOT source/target. The first version of
  // this function asked for source_task_id and discarded the error with `const { data }`, so it
  // returned an empty array forever and the timeline reported no dependency conflicts at all -
  // silently, because "no conflicts" is exactly what a healthy schedule looks like. The browser
  // harness caught it; nothing else could have. Keep the error.
  const { data, error } = await supabase
    .from('task_relations_expanded')
    .select('task_id, related_task_id, relation')
    .in('relation', ['blocks', 'precedes'])
    .in('task_id', taskIds)

  if (error) {
    console.error('[timeline] could not load scheduling relations:', error.message)
    return []
  }

  // Only the FORWARD directions are selected above: 115's view expands each stored row into
  // both, naming the inverses `blocked_by` and `follows`. Taking both would double every
  // conflict and put the warning on the predecessor as well as the successor.
  return (data ?? [])
    .filter((row: any) => taskIds.includes(row.related_task_id))
    .map((row: any) => ({
      sourceId: row.task_id,
      targetId: row.related_task_id,
      kind: row.relation as 'blocks' | 'precedes',
    }))
}

/* ── Milestone writes ──────────────────────────────────────────────────────────────── */

export async function createMilestone(
  supabase: Client,
  draft: MilestoneDraft,
  userId: string | null,
): Promise<TimelineWrite & { milestone?: MilestoneRow }> {
  const res = await supabase
    .from('milestones')
    .insert({ ...draft, created_by: userId })
    .select(MILESTONE_COLUMNS)
  return { outcome: await classifyWrite(res), milestone: res.data?.[0] }
}

/**
 * @param patch `state_note` rides in the SAME statement as `state`, because migration 133's
 *        trigger blanks the carrier on every path out. Sending the note in a second write
 *        would find it already cleared, which is 103's carrier-column design and 104's bug.
 *
 * ⚠️ The `stillReadable` probe is supplied only when `owner_id` is in the patch. Handing a
 * milestone to somebody else is a write that succeeds and then removes the writer's own UPDATE
 * right (133's owner policy is `owner_id = auth.uid()`), so zero returned rows there means
 * "saved, and now out of your reach" rather than "refused". Every other field is invisible to
 * both policies, so a probe would be a wasted round trip that can only add a wrong answer.
 */
export async function updateMilestone(
  supabase: Client,
  milestoneId: string,
  patch: Partial<MilestoneDraft & { state: MilestoneState; state_note: string | null }>,
): Promise<TimelineWrite & { milestone?: MilestoneRow }> {
  const res = await supabase
    .from('milestones')
    .update(patch)
    .eq('id', milestoneId)
    .select(MILESTONE_COLUMNS)

  const changesOwnership = Object.prototype.hasOwnProperty.call(patch, 'owner_id')
  const outcome = await classifyWrite(res, {
    stillReadable: changesOwnership
      ? async () => {
          const { data } = await supabase.from('milestones').select('id').eq('id', milestoneId)
          return (data?.length ?? 0) > 0
        }
      : undefined,
  })
  return { outcome, milestone: res.data?.[0] }
}

export async function deleteMilestone(
  supabase: Client,
  milestoneId: string,
): Promise<TimelineWrite> {
  const res = await supabase.from('milestones').delete().eq('id', milestoneId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function linkMilestoneTask(
  supabase: Client,
  milestoneId: string,
  taskId: string,
  userId: string | null,
): Promise<TimelineWrite> {
  const res = await supabase
    .from('milestone_tasks')
    .insert({ milestone_id: milestoneId, task_id: taskId, added_by: userId })
    .select('milestone_id')
  return { outcome: await classifyWrite(res) }
}

export async function unlinkMilestoneTask(
  supabase: Client,
  milestoneId: string,
  taskId: string,
): Promise<TimelineWrite> {
  const res = await supabase
    .from('milestone_tasks')
    .delete()
    .eq('milestone_id', milestoneId)
    .eq('task_id', taskId)
    .select('milestone_id')
  return { outcome: await classifyWrite(res) }
}

/* ── Schedule writes ───────────────────────────────────────────────────────────────── */

/**
 * Write a task's planned dates.
 *
 * ⚠️ BOTH ends go through `dueDateForStorage`, which always yields YYYY-MM-DDT00:00:00.000Z.
 * That is not optional politeness: `task-card` and `task-detail-modal` both used to write
 * `pickerDate.toISOString()`, which encodes LOCAL midnight, so every user east of Greenwich
 * stored the day BEFORE the one they clicked - silently, since nothing about the value looks
 * wrong. `start_date` is the sixth column in this family and it is not repeating that.
 *
 * ⚠️ No `stillReadable` probe: neither date is an input to `can_view_task`, so this write
 * cannot change who can see the row. lib/rls-write.ts names exactly this set (title, priority,
 * due date, column, position) as needing no probe.
 */
export async function setTaskSchedule(
  supabase: Client,
  taskId: string,
  schedule: { start: string | null; due: string | null },
): Promise<TimelineWrite> {
  const res = await supabase
    .from('tasks')
    .update({
      start_date: dueDateForStorage(schedule.start),
      due_date: dueDateForStorage(schedule.due),
    })
    .eq('id', taskId)
    .select('id, start_date, due_date')
  return { outcome: await classifyWrite(res) }
}
