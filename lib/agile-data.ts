// The agile module's database calls, in one place.
//
// Every write here asks for its rows back and counts them, because an RLS refusal returns zero
// rows and NO error - this repo's single most repeated defect (see lib/rls-write.ts). None of
// these writes can change the row's own visibility, so the cheap unambiguous classification is
// correct and no probe is needed: a sprint's visibility follows its board, and a membership
// row's follows its task, neither of which any of these statements touches.
//
// Not a React module: `loadAgileBoardData` is called from a Server Component, so nothing here
// may import a hook (the mistake lib/module-registry.ts exists to have fixed once already).

import { classifyWrite, didWrite, writeFailureMessage, type WriteOutcome } from './rls-write'
import {
  normalizeAgileSettings, type AgileSettings, type EnforcementMode, type EstimateUnit,
  type SprintState, type Terminology,
} from './agile'
import type { BurndownSampleRow, SprintMetricsRow } from './sprint-metrics'

type Client = any

/**
 * What every write below returns.
 *
 * Deliberately NOT rls-write's `WriteResult` - that is the supabase-js response shape going
 * IN. This is the classified answer coming out, and conflating the two is how a caller ends
 * up checking `.error` again and re-introducing the zero-row blind spot.
 */
export interface AgileWrite {
  outcome: WriteOutcome
}

export const SPRINT_COLUMNS =
  'id, board_id, title, goal, start_date, end_date, owner_id, state, capacity, activated_at, closed_at, position, created_by, created_at'

export const SPRINT_ITEM_COLUMNS =
  'id, sprint_id, task_id, added_at, added_by, committed, estimate_at_commit, removed_at, removed_count'

export const AGILE_SETTINGS_COLUMNS =
  'board_id, is_enabled, terminology, estimate_unit, capacity_mode, wip_mode'

export interface SprintRow {
  id: string
  board_id: string
  title: string
  goal: string | null
  start_date: string
  end_date: string
  owner_id: string | null
  state: SprintState
  capacity: number | string | null
  activated_at: string | null
  closed_at: string | null
  position: number
  created_by: string | null
  created_at: string
}

export interface SprintItemRow {
  id: string
  sprint_id: string
  task_id: string
  added_at: string
  added_by: string | null
  committed: boolean
  estimate_at_commit: number | string | null
  removed_at: string | null
  removed_count: number
}

/* ── Reads ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the agile surface needs for one board, with the CALLER'S OWN session.
 *
 * ⚠️ RLS has already decided what comes back, and nothing downstream may treat an absence as a
 * fact about the world. In particular a board with zero sprints and a board whose sprints the
 * caller cannot see look identical here - which cannot happen in practice, because the sprints
 * SELECT policy is exactly "you can see the board", and you had to be able to see the board to
 * get its id. That is stated rather than assumed, because it is the only reason the counts on
 * this screen are honest.
 */
export async function loadAgileBoardData(supabase: Client, boardId: string) {
  const [settings, sprints, items, snapshots, samples] = await Promise.all([
    supabase.from('board_agile_settings').select(AGILE_SETTINGS_COLUMNS).eq('board_id', boardId).maybeSingle(),
    supabase.from('sprints').select(SPRINT_COLUMNS).eq('board_id', boardId).order('start_date', { ascending: false }),
    supabase.from('sprint_items').select(`${SPRINT_ITEM_COLUMNS}, sprint:sprints!inner(board_id)`).eq('sprint.board_id', boardId),
    supabase.from('sprint_metrics').select('*'),
    supabase.from('sprint_burndown_samples').select('*').order('on_date'),
  ])

  const sprintRows: SprintRow[] = sprints.data ?? []
  const ids = new Set(sprintRows.map((s) => s.id))

  return {
    settings: normalizeAgileSettings(boardId, settings.data),
    sprints: sprintRows,
    items: (items.data ?? []) as SprintItemRow[],
    // Both ledgers are queried unscoped and filtered here: they carry no board_id of their own
    // (they hang off the sprint), and a PostgREST embed on a read-only table buys nothing.
    snapshots: ((snapshots.data ?? []) as SprintMetricsRow[]).filter((s) => ids.has(s.sprint_id)),
    samples: ((samples.data ?? []) as BurndownSampleRow[]).filter((s) => ids.has(s.sprint_id)),
    // Kept, never discarded: dropping the error renders a failed query as "no sprints yet",
    // which is the most reassuring possible way to tell somebody their workspace is broken.
    loadFailed: Boolean(sprints.error || items.error),
    errorMessage: sprints.error?.message ?? items.error?.message ?? null,
  }
}

export type AgileBoardData = Awaited<ReturnType<typeof loadAgileBoardData>>

/* ── Settings ─────────────────────────────────────────────────────────────────────── */

/**
 * Create-or-update the board's settings.
 *
 * ⚠️ NOT `.upsert()`. PostgREST's default upsert is `ON CONFLICT DO UPDATE`, and Postgres
 * demands the UPDATE privilege for that whether or not a conflict occurs - the exact trap that
 * made `board_mutes` refuse every write in Prompt F. Here the table does grant UPDATE, so an
 * upsert would work; it is still written as an explicit insert-then-update so the two RLS
 * outcomes stay distinguishable. A refused INSERT and a refused UPDATE are different problems
 * and deserve different messages.
 */
export async function saveAgileSettings(
  supabase: Client,
  boardId: string,
  patch: Partial<Omit<AgileSettings, 'board_id'>>,
  userId: string | null,
): Promise<AgileWrite & { settings?: AgileSettings }> {
  const existing = await supabase.from('board_agile_settings').select('board_id').eq('board_id', boardId).maybeSingle()

  if (existing.data) {
    const res = await supabase
      .from('board_agile_settings')
      .update({ ...patch, updated_by: userId })
      .eq('board_id', boardId)
      .select(AGILE_SETTINGS_COLUMNS)
    const outcome = await classifyWrite(res)
    return { outcome, settings: res.data?.[0] ? normalizeAgileSettings(boardId, res.data[0]) : undefined }
  }

  const res = await supabase
    .from('board_agile_settings')
    .insert({ board_id: boardId, ...patch, updated_by: userId })
    .select(AGILE_SETTINGS_COLUMNS)
  const outcome = await classifyWrite(res)
  return { outcome, settings: res.data?.[0] ? normalizeAgileSettings(boardId, res.data[0]) : undefined }
}

/* ── Sprints ──────────────────────────────────────────────────────────────────────── */

export interface SprintDraft {
  title: string
  goal: string | null
  start_date: string
  end_date: string
  owner_id: string | null
  capacity: number | null
}

export async function createSprint(
  supabase: Client, boardId: string, draft: SprintDraft, userId: string | null,
): Promise<AgileWrite & { sprint?: SprintRow }> {
  const res = await supabase
    .from('sprints')
    .insert({ board_id: boardId, ...draft, created_by: userId, state: 'planned' })
    .select(SPRINT_COLUMNS)
  return { outcome: await classifyWrite(res), sprint: res.data?.[0] }
}

export async function updateSprint(
  supabase: Client, sprintId: string, patch: Partial<SprintDraft>,
): Promise<AgileWrite & { sprint?: SprintRow }> {
  const res = await supabase.from('sprints').update(patch).eq('id', sprintId).select(SPRINT_COLUMNS)
  return { outcome: await classifyWrite(res), sprint: res.data?.[0] }
}

/**
 * Move a sprint's state.
 *
 * The database owns the consequences: migration 123 stamps activated_at and marks everything
 * present as committed on start, and 124's trigger freezes the metrics on close. Nothing is
 * computed here, deliberately - a client that wrote its own commitment flags could make any
 * sprint look fully delivered.
 */
export async function setSprintState(
  supabase: Client, sprintId: string, state: SprintState,
): Promise<AgileWrite & { sprint?: SprintRow }> {
  const res = await supabase.from('sprints').update({ state }).eq('id', sprintId).select(SPRINT_COLUMNS)
  return { outcome: await classifyWrite(res), sprint: res.data?.[0] }
}

export async function deleteSprint(supabase: Client, sprintId: string): Promise<AgileWrite> {
  const res = await supabase.from('sprints').delete().eq('id', sprintId).select('id')
  return { outcome: await classifyWrite(res) }
}

/* ── Membership ───────────────────────────────────────────────────────────────────── */

/**
 * Put a work item in a sprint.
 *
 * ⚠️ A task may have been in this sprint before and been removed - migration 123 keeps that row
 * so the history survives, with a UNIQUE (sprint_id, task_id). So "add" is genuinely
 * insert-or-un-remove, and an INSERT alone would fail with a raw 23505 the second time round.
 */
export async function addToSprint(
  supabase: Client, sprintId: string, taskId: string, userId: string | null,
): Promise<AgileWrite & { item?: SprintItemRow }> {
  const existing = await supabase
    .from('sprint_items').select(SPRINT_ITEM_COLUMNS)
    .eq('sprint_id', sprintId).eq('task_id', taskId).maybeSingle()

  if (existing.data) {
    if (!existing.data.removed_at) return { outcome: { kind: 'ok' }, item: existing.data }
    const res = await supabase
      .from('sprint_items').update({ removed_at: null }).eq('id', existing.data.id).select(SPRINT_ITEM_COLUMNS)
    return { outcome: await classifyWrite(res), item: res.data?.[0] }
  }

  const res = await supabase
    .from('sprint_items').insert({ sprint_id: sprintId, task_id: taskId, added_by: userId })
    .select(SPRINT_ITEM_COLUMNS)
  return { outcome: await classifyWrite(res), item: res.data?.[0] }
}

/**
 * Take a work item out of a sprint.
 *
 * A soft removal, never a DELETE - `authenticated` holds no DELETE grant on sprint_items at all
 * (migration 123), because deleting the row is how a sprint's history quietly becomes
 * flattering. The removal is what "scope removed" counts.
 */
export async function removeFromSprint(
  supabase: Client, sprintId: string, taskId: string,
): Promise<AgileWrite> {
  const res = await supabase
    .from('sprint_items')
    .update({ removed_at: new Date().toISOString() })
    .eq('sprint_id', sprintId).eq('task_id', taskId).is('removed_at', null)
    .select('id')
  return { outcome: await classifyWrite(res) }
}

/** Move an item from one sprint to another: out of the first, into the second. */
export async function moveBetweenSprints(
  supabase: Client, fromSprintId: string | null, toSprintId: string, taskId: string, userId: string | null,
): Promise<AgileWrite> {
  if (fromSprintId) {
    const out = await removeFromSprint(supabase, fromSprintId, taskId)
    // A refusal here must stop the move: adding without removing would trip the one-live-sprint
    // index and report a confusing unique-violation instead of the real permission problem.
    if (!didWrite(out.outcome)) return out
  }
  const res = await addToSprint(supabase, toSprintId, taskId, userId)
  return { outcome: res.outcome }
}

/* ── Estimates and WIP limits ─────────────────────────────────────────────────────── */

export async function setTaskEstimate(
  supabase: Client, taskId: string, estimate: number | null,
): Promise<AgileWrite> {
  // Not an input to can_view_task, so no visibility probe is needed (lib/rls-write.ts).
  const res = await supabase.from('tasks').update({ estimate_value: estimate }).eq('id', taskId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function setColumnWipLimit(
  supabase: Client, columnId: string, limit: number | null,
): Promise<AgileWrite> {
  const res = await supabase.from('columns').update({ wip_limit: limit }).eq('id', columnId).select('id, wip_limit')
  return { outcome: await classifyWrite(res) }
}

/**
 * Persist a priority reordering.
 *
 * ⚠️ `expected` is the row count, so a PARTIAL refusal is reported as a failure rather than as
 * a success over a half-renumbered column. That matters more here than almost anywhere else in
 * the module: a reorder that lands for four of six rows leaves duplicate positions, and the
 * board's own drag-and-drop then has to reconcile an order nobody chose.
 *
 * The writes go one at a time because PostgREST has no multi-row UPDATE with per-row values,
 * and the alternative - an upsert of whole task rows - would send every other column of every
 * task back to the server and race with anyone editing one.
 */
export async function reorderBacklog(
  supabase: Client, updates: { id: string; position: number }[],
): Promise<AgileWrite & { moved: number }> {
  let moved = 0
  let firstFailure: WriteOutcome | null = null

  for (const { id, position } of updates) {
    const res = await supabase.from('tasks').update({ position }).eq('id', id).select('id')
    const outcome = await classifyWrite(res)
    if (didWrite(outcome)) moved++
    else if (!firstFailure) firstFailure = outcome
  }

  if (firstFailure && moved < updates.length) return { outcome: firstFailure, moved }
  return { outcome: { kind: 'ok' }, moved }
}

/* ── Burndown sampling ────────────────────────────────────────────────────────────── */

/**
 * Take today's burndown point for a running sprint.
 *
 * The Vercel Hobby plan runs cron once a day (see /api/cron/scheduled-work), which is enough
 * for the overnight point and not enough to keep a chart current while people are working. So
 * the page samples on open - migration 124's function refreshes TODAY only and never rewrites a
 * past day, which is what keeps the curve a record rather than a redrawing.
 */
export async function sampleBurndown(supabase: Client, sprintId: string): Promise<BurndownSampleRow | null> {
  const { data, error } = await supabase.rpc('sample_sprint_burndown', { p_sprint_id: sprintId })
  if (error) return null
  return (Array.isArray(data) ? data[0] : data) ?? null
}

/* ── Messages ─────────────────────────────────────────────────────────────────────── */

export { didWrite, writeFailureMessage }
export type { AgileSettings, EnforcementMode, EstimateUnit, Terminology }
