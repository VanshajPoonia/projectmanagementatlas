// Every database call the strategy module makes, in one place.
//
// Every write asks for its rows back and classifies the count, because an RLS refusal returns
// zero rows and NO error - this repo's single most repeated defect (lib/rls-write.ts). None of
// these statements can change a row's own visibility, so the cheap unambiguous classification
// is correct and no probe is needed: a goal is readable by everyone signed in, and a
// retrospective's visibility follows its board, which none of these writes touches.
//
// Not a React module - app/strategy/page.tsx calls `loadStrategyData` from a Server Component,
// so nothing here may import a hook. That is the mistake lib/module-registry.ts exists to have
// fixed once already.

import { classifyWrite, type WriteOutcome } from './rls-write'
import { dueDateForStorage } from './calendar-grid'
import type { GoalCheckinRow, GoalLinkRow, GoalRow, GoalState } from './goals'
import type { IdeaEventRow, IdeaNoteRow, IdeaRow, IdeaState } from './ideas'
import type { StrategyItemRow, SwotBucket } from './strategy'
import type {
  RetroActionRow, RetroGroupRow, RetroNoteRow, RetroState, RetroTemplate, RetrospectiveRow,
} from './retrospectives'

type Client = any

export interface StrategyWrite {
  outcome: WriteOutcome
}

// The select lists. Internal by default: only the ones a component genuinely re-reads are
// exported, so an exported constant here always has a consumer rather than sitting available
// and unused - the shape this codebase keeps paying for.
const GOAL_COLUMNS =
  'id, title, description, owner_id, starts_on, ends_on, metric, unit, start_value, current_value, ' +
  'target_value, confidence, health, state, position, created_by, created_at, updated_at'

const GOAL_LINK_COLUMNS = 'id, goal_id, board_id, task_id, created_at'
const GOAL_CHECKIN_COLUMNS = 'id, goal_id, on_date, current_value, confidence, health, note, kind, created_by, created_at'

const IDEA_COLUMNS =
  'id, title, problem, target_customer, evidence, expected_value, impact, effort, confidence, ' +
  'state, converted_board_id, converted_task_id, converted_at, position, created_by, created_at, updated_at'

export const IDEA_EVENT_COLUMNS = 'id, idea_id, kind, from_state, to_state, note, created_by, created_at'
const IDEA_NOTE_COLUMNS = 'id, idea_id, body, created_by, created_at, updated_at'
const STRATEGY_ITEM_COLUMNS = 'id, board_id, canvas, bucket, body, position, created_by, created_at'

const PURPOSE_COLUMNS =
  'board_id, problem_statement, purpose, intended_outcome, stakeholders, target_customer, ' +
  'success_criteria, constraints, non_goals, updated_at, updated_by'

const RETRO_COLUMNS = 'id, board_id, sprint_id, title, template, is_anonymous, state, held_on, created_by, created_at'
// ⚠️ author_id is selected on purpose and is NULL on every anonymous note - it is the PUBLIC
// author, not the real one. The real one lives in a table `authenticated` holds no privilege
// on; see migration 132. Nothing in this module ever asks for it.
const RETRO_NOTE_COLUMNS = 'id, retro_id, column_key, body, group_id, position, author_id, vote_count, created_at'
const RETRO_GROUP_COLUMNS = 'id, retro_id, title, position'
const RETRO_ACTION_COLUMNS = 'id, retro_id, note_id, body, owner_id, due_date, task_id, converted_at, created_by, created_at'

export interface BoardPurposeRow {
  board_id: string
  problem_statement?: string | null
  purpose?: string | null
  intended_outcome?: string | null
  stakeholders?: string | null
  target_customer?: string | null
  success_criteria?: string | null
  constraints?: string | null
  non_goals?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

/* ── Reads ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the strategy surface needs, with the CALLER'S OWN session.
 *
 * ⚠️ RLS has already decided what is in these arrays, and nothing downstream may treat an
 * absence as a fact about the world. It matters most for goal_links: a link to a task on a
 * board this person cannot see comes back (the link row is readable) with no task behind it,
 * and lib/goals.ts reports that as `unresolved` rather than counting it as unfinished work.
 */
export async function loadStrategyData(supabase: Client) {
  const [goals, links, checkins, ideas, ideaEvents, ideaNotes, canvas, purposes] = await Promise.all([
    supabase.from('goals').select(GOAL_COLUMNS).order('position'),
    supabase.from('goal_links').select(GOAL_LINK_COLUMNS),
    supabase.from('goal_checkins').select(GOAL_CHECKIN_COLUMNS).order('created_at'),
    supabase.from('ideas').select(IDEA_COLUMNS).order('position'),
    supabase.from('idea_events').select(IDEA_EVENT_COLUMNS).order('created_at'),
    supabase.from('idea_notes').select(IDEA_NOTE_COLUMNS).order('created_at'),
    supabase.from('strategy_items').select(STRATEGY_ITEM_COLUMNS).order('position'),
    supabase.from('board_purpose').select(PURPOSE_COLUMNS),
  ])

  return {
    goals: (goals.data ?? []) as GoalRow[],
    links: (links.data ?? []) as GoalLinkRow[],
    checkins: (checkins.data ?? []) as GoalCheckinRow[],
    ideas: (ideas.data ?? []) as IdeaRow[],
    ideaEvents: (ideaEvents.data ?? []) as IdeaEventRow[],
    ideaNotes: (ideaNotes.data ?? []) as IdeaNoteRow[],
    canvas: (canvas.data ?? []) as StrategyItemRow[],
    purposes: (purposes.data ?? []) as BoardPurposeRow[],
    // One flag rather than eight. Every consumer's response is the same - say the counts are
    // incomplete and do not act on them - and eight booleans would invite a screen to decide
    // which failures matter, which is a decision nobody should be making at render time.
    loadFailed: Boolean(
      goals.error || links.error || checkins.error || ideas.error ||
      ideaEvents.error || ideaNotes.error || canvas.error || purposes.error,
    ),
  }
}

export async function loadRetrospectives(supabase: Client, boardId: string) {
  const retros = await supabase
    .from('retrospectives').select(RETRO_COLUMNS).eq('board_id', boardId).order('created_at', { ascending: false })

  const ids = (retros.data ?? []).map((r: RetrospectiveRow) => r.id)
  if (ids.length === 0) {
    return { retros: [] as RetrospectiveRow[], notes: [] as RetroNoteRow[], groups: [] as RetroGroupRow[], actions: [] as RetroActionRow[], loadFailed: Boolean(retros.error) }
  }

  const [notes, groups, actions] = await Promise.all([
    supabase.from('retro_notes').select(RETRO_NOTE_COLUMNS).in('retro_id', ids),
    supabase.from('retro_note_groups').select(RETRO_GROUP_COLUMNS).in('retro_id', ids).order('position'),
    supabase.from('retro_actions').select(RETRO_ACTION_COLUMNS).in('retro_id', ids).order('created_at'),
  ])

  return {
    retros: (retros.data ?? []) as RetrospectiveRow[],
    notes: (notes.data ?? []) as RetroNoteRow[],
    groups: (groups.data ?? []) as RetroGroupRow[],
    actions: (actions.data ?? []) as RetroActionRow[],
    loadFailed: Boolean(retros.error || notes.error || groups.error || actions.error),
  }
}

/**
 * Which notes in this retrospective are mine.
 *
 * ⚠️ An RPC rather than a query, and that is the anonymity design rather than a style choice.
 * `retro_notes.author_id` is NULL on every anonymous note and the real author lives in a table
 * with no grants, so the only honest way to answer "which of these can I edit" is a SECURITY
 * DEFINER function that resolves past RLS and returns the narrowest possible answer - the
 * caller's own ids and nothing else (migration 132, and 122's notify_task_watchers before it).
 */
export async function loadMyNoteIds(supabase: Client, retroId: string): Promise<Set<string>> {
  const { data } = await supabase.rpc('my_retro_note_ids', { p_retro: retroId })
  if (!Array.isArray(data)) return new Set()
  // The function returns SETOF uuid, which PostgREST renders as an array of bare strings.
  return new Set(data.map((row: unknown) => (typeof row === 'string' ? row : (row as { id?: string })?.id ?? '')).filter(Boolean))
}

export async function loadMyVotes(supabase: Client, noteIds: string[]): Promise<Set<string>> {
  if (noteIds.length === 0) return new Set()
  // RLS scopes retro_votes to the caller's own rows in every direction, so this asks for
  // "every vote on these notes" and can only ever receive its own. That is the point: there
  // is no query anybody can write that returns somebody else's vote.
  const { data } = await supabase.from('retro_votes').select('note_id').in('note_id', noteIds)
  return new Set((data ?? []).map((row: { note_id: string }) => row.note_id))
}

/* ── Purpose ──────────────────────────────────────────────────────────────────────── */

export async function saveBoardPurpose(
  supabase: Client, boardId: string, patch: Partial<Omit<BoardPurposeRow, 'board_id'>>, userId: string | null,
): Promise<StrategyWrite & { purpose?: BoardPurposeRow }> {
  // Insert-or-update rather than upsert, for the reason board_mutes (120) had to learn the
  // hard way: PostgREST's default upsert is ON CONFLICT DO UPDATE, and Postgres wants the
  // UPDATE privilege for that whether or not a conflict occurs. Two explicit statements also
  // keep a refused INSERT and a refused UPDATE distinguishable, which are different problems.
  const existing = await supabase.from('board_purpose').select('board_id').eq('board_id', boardId).maybeSingle()

  if (existing.data) {
    const res = await supabase.from('board_purpose').update({ ...patch, updated_by: userId }).eq('board_id', boardId).select(PURPOSE_COLUMNS)
    return { outcome: await classifyWrite(res), purpose: res.data?.[0] }
  }
  const res = await supabase.from('board_purpose').insert({ board_id: boardId, ...patch, updated_by: userId }).select(PURPOSE_COLUMNS)
  return { outcome: await classifyWrite(res), purpose: res.data?.[0] }
}

/* ── Goals ────────────────────────────────────────────────────────────────────────── */

export interface GoalDraft {
  title: string
  description: string | null
  owner_id: string | null
  starts_on: string | null
  ends_on: string | null
  metric: string | null
  unit: string | null
  start_value: number | null
  current_value: number | null
  target_value: number | null
  confidence: GoalRow['confidence']
  health: GoalRow['health']
}

export async function createGoal(
  supabase: Client, draft: GoalDraft, userId: string | null,
): Promise<StrategyWrite & { goal?: GoalRow }> {
  const res = await supabase.from('goals').insert({ ...draft, created_by: userId }).select(GOAL_COLUMNS)
  return { outcome: await classifyWrite(res), goal: res.data?.[0] }
}

/**
 * @param checkinNote rides in the SAME statement as the numbers, because migration 129's
 *        ledger is not application-writable and a second write afterwards is exactly the
 *        design that table refuses. It is a write-only carrier: it never comes back.
 */
export async function updateGoal(
  supabase: Client, goalId: string, patch: Partial<GoalDraft & { state: GoalState; position: number }>, checkinNote?: string | null,
): Promise<StrategyWrite & { goal?: GoalRow }> {
  const payload: Record<string, unknown> = { ...patch }
  const note = checkinNote?.trim()
  if (note) payload.checkin_note = note
  const res = await supabase.from('goals').update(payload).eq('id', goalId).select(GOAL_COLUMNS)
  return { outcome: await classifyWrite(res), goal: res.data?.[0] }
}

export async function deleteGoal(supabase: Client, goalId: string): Promise<StrategyWrite> {
  const res = await supabase.from('goals').delete().eq('id', goalId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function linkGoal(
  supabase: Client, goalId: string, end: { board_id?: string; task_id?: string }, userId: string | null,
): Promise<StrategyWrite & { link?: GoalLinkRow }> {
  const res = await supabase.from('goal_links').insert({ goal_id: goalId, ...end, created_by: userId }).select(GOAL_LINK_COLUMNS)
  return { outcome: await classifyWrite(res), link: res.data?.[0] }
}

export async function unlinkGoal(supabase: Client, linkId: string): Promise<StrategyWrite> {
  const res = await supabase.from('goal_links').delete().eq('id', linkId).select('id')
  return { outcome: await classifyWrite(res) }
}

/* ── Ideas ────────────────────────────────────────────────────────────────────────── */

export interface IdeaDraft {
  title: string
  problem: string | null
  target_customer: string | null
  evidence: string | null
  expected_value: string | null
  impact: IdeaRow['impact']
  effort: IdeaRow['effort']
  confidence: IdeaRow['confidence']
}

export async function createIdea(
  supabase: Client, draft: IdeaDraft, userId: string | null,
): Promise<StrategyWrite & { idea?: IdeaRow }> {
  const res = await supabase.from('ideas').insert({ ...draft, created_by: userId }).select(IDEA_COLUMNS)
  return { outcome: await classifyWrite(res), idea: res.data?.[0] }
}

export async function updateIdea(
  supabase: Client, ideaId: string, patch: Partial<IdeaDraft & { position: number }>,
): Promise<StrategyWrite & { idea?: IdeaRow }> {
  const res = await supabase.from('ideas').update(patch).eq('id', ideaId).select(IDEA_COLUMNS)
  return { outcome: await classifyWrite(res), idea: res.data?.[0] }
}

/**
 * @param note required when moving to `rejected` - enforced by migration 130's trigger, not
 *        by the dialog. Passing none there produces a check_violation with the reason in its
 *        message, which is what the caller shows.
 */
export async function moveIdea(
  supabase: Client, ideaId: string, state: IdeaState, note?: string | null,
): Promise<StrategyWrite & { idea?: IdeaRow }> {
  const payload: Record<string, unknown> = { state }
  const trimmed = note?.trim()
  if (trimmed) payload.state_note = trimmed
  const res = await supabase.from('ideas').update(payload).eq('id', ideaId).select(IDEA_COLUMNS)
  return { outcome: await classifyWrite(res), idea: res.data?.[0] }
}

export async function deleteIdea(supabase: Client, ideaId: string): Promise<StrategyWrite> {
  const res = await supabase.from('ideas').delete().eq('id', ideaId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function addIdeaNote(
  supabase: Client, ideaId: string, body: string, userId: string | null,
): Promise<StrategyWrite & { note?: IdeaNoteRow }> {
  const res = await supabase.from('idea_notes').insert({ idea_id: ideaId, body, created_by: userId }).select(IDEA_NOTE_COLUMNS)
  return { outcome: await classifyWrite(res), note: res.data?.[0] }
}

export async function deleteIdeaNote(supabase: Client, noteId: string): Promise<StrategyWrite> {
  const res = await supabase.from('idea_notes').delete().eq('id', noteId).select('id')
  return { outcome: await classifyWrite(res) }
}

/**
 * Turn a validated idea into real work.
 *
 * ⚠️ The idea is NOT moved and NOT copied. A `tasks` row (or a board) is created by the caller
 * and this records the pointer, so every board, view, report and My Work section reads the one
 * canonical work item while the reasoning behind it stays where it was written. `converted_at`
 * is stamped by 130's trigger and cannot be supplied.
 */
export async function recordConversion(
  supabase: Client, ideaId: string, pointer: { converted_board_id?: string; converted_task_id?: string },
): Promise<StrategyWrite & { idea?: IdeaRow }> {
  const res = await supabase.from('ideas').update({ ...pointer, state: 'planned' }).eq('id', ideaId).select(IDEA_COLUMNS)
  return { outcome: await classifyWrite(res), idea: res.data?.[0] }
}

/* ── SWOT ─────────────────────────────────────────────────────────────────────────── */

export async function addCanvasItem(
  supabase: Client, scope: { board_id: string | null }, bucket: SwotBucket, body: string, userId: string | null,
): Promise<StrategyWrite & { item?: StrategyItemRow }> {
  const res = await supabase
    .from('strategy_items')
    .insert({ board_id: scope.board_id, canvas: 'swot', bucket, body, created_by: userId })
    .select(STRATEGY_ITEM_COLUMNS)
  return { outcome: await classifyWrite(res), item: res.data?.[0] }
}

export async function updateCanvasItem(
  supabase: Client, itemId: string, body: string,
): Promise<StrategyWrite & { item?: StrategyItemRow }> {
  const res = await supabase.from('strategy_items').update({ body }).eq('id', itemId).select(STRATEGY_ITEM_COLUMNS)
  return { outcome: await classifyWrite(res), item: res.data?.[0] }
}

export async function deleteCanvasItem(supabase: Client, itemId: string): Promise<StrategyWrite> {
  const res = await supabase.from('strategy_items').delete().eq('id', itemId).select('id')
  return { outcome: await classifyWrite(res) }
}

/* ── Retrospectives ───────────────────────────────────────────────────────────────── */

export interface RetroDraft {
  title: string
  template: RetroTemplate
  is_anonymous: boolean
  held_on: string | null
  sprint_id: string | null
}

export async function createRetro(
  supabase: Client, boardId: string, draft: RetroDraft, userId: string | null,
): Promise<StrategyWrite & { retro?: RetrospectiveRow }> {
  const res = await supabase.from('retrospectives').insert({ board_id: boardId, ...draft, created_by: userId }).select(RETRO_COLUMNS)
  return { outcome: await classifyWrite(res), retro: res.data?.[0] }
}

/**
 * ⚠️ `is_anonymous` is deliberately absent from what this can change - migration 132 refuses
 * it in both directions, because people wrote under the rule that was in force at the time
 * and there is no undo for exposing them. The dialog does not offer it either.
 */
export async function updateRetro(
  supabase: Client, retroId: string, patch: Partial<Pick<RetroDraft, 'title' | 'held_on' | 'template'>> & { state?: RetroState },
): Promise<StrategyWrite & { retro?: RetrospectiveRow }> {
  const res = await supabase.from('retrospectives').update(patch).eq('id', retroId).select(RETRO_COLUMNS)
  return { outcome: await classifyWrite(res), retro: res.data?.[0] }
}

export async function deleteRetro(supabase: Client, retroId: string): Promise<StrategyWrite> {
  const res = await supabase.from('retrospectives').delete().eq('id', retroId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function addRetroNote(
  supabase: Client, retroId: string, columnKey: string, body: string,
): Promise<StrategyWrite & { note?: RetroNoteRow }> {
  // No author is sent. 132's trigger decides it - NULL on an anonymous retro, the signed-in
  // person otherwise - so a client cannot claim to be someone else and cannot accidentally
  // attribute an anonymous note by including a field it happened to have to hand.
  const res = await supabase.from('retro_notes').insert({ retro_id: retroId, column_key: columnKey, body }).select(RETRO_NOTE_COLUMNS)
  return { outcome: await classifyWrite(res), note: res.data?.[0] }
}

export async function updateRetroNote(
  supabase: Client, noteId: string, patch: { body?: string; group_id?: string | null; column_key?: string; position?: number },
): Promise<StrategyWrite & { note?: RetroNoteRow }> {
  const res = await supabase.from('retro_notes').update(patch).eq('id', noteId).select(RETRO_NOTE_COLUMNS)
  return { outcome: await classifyWrite(res), note: res.data?.[0] }
}

export async function deleteRetroNote(supabase: Client, noteId: string): Promise<StrategyWrite> {
  const res = await supabase.from('retro_notes').delete().eq('id', noteId).select('id')
  return { outcome: await classifyWrite(res) }
}

export async function createRetroGroup(
  supabase: Client, retroId: string, title: string, userId: string | null,
): Promise<StrategyWrite & { group?: RetroGroupRow }> {
  const res = await supabase.from('retro_note_groups').insert({ retro_id: retroId, title, created_by: userId }).select(RETRO_GROUP_COLUMNS)
  return { outcome: await classifyWrite(res), group: res.data?.[0] }
}

export async function deleteRetroGroup(supabase: Client, groupId: string): Promise<StrategyWrite> {
  // The notes survive: retro_notes.group_id is ON DELETE SET NULL, so removing a theme
  // ungroups its notes rather than destroying what people wrote.
  const res = await supabase.from('retro_note_groups').delete().eq('id', groupId).select('id')
  return { outcome: await classifyWrite(res) }
}

/**
 * Cast or withdraw a vote.
 *
 * ⚠️ Insert-then-delete rather than upsert, and it matters here for the same reason it did on
 * board_mutes (120): `retro_votes` has no UPDATE grant at all, and PostgREST's default upsert
 * is ON CONFLICT DO UPDATE, which Postgres refuses without that privilege whether or not a
 * conflict occurs.
 */
export async function setVote(
  supabase: Client, noteId: string, userId: string, voted: boolean,
): Promise<StrategyWrite> {
  if (voted) {
    const res = await supabase.from('retro_votes').insert({ note_id: noteId, user_id: userId }).select('note_id')
    return { outcome: await classifyWrite(res) }
  }
  const res = await supabase.from('retro_votes').delete().eq('note_id', noteId).eq('user_id', userId).select('note_id')
  return { outcome: await classifyWrite(res) }
}

export async function addRetroAction(
  supabase: Client, retroId: string, body: string, extras: { note_id?: string | null; owner_id?: string | null; due_date?: string | null }, userId: string | null,
): Promise<StrategyWrite & { action?: RetroActionRow }> {
  const res = await supabase.from('retro_actions').insert({ retro_id: retroId, body, ...extras, created_by: userId }).select(RETRO_ACTION_COLUMNS)
  return { outcome: await classifyWrite(res), action: res.data?.[0] }
}

export async function updateRetroAction(
  supabase: Client, actionId: string, patch: { body?: string; owner_id?: string | null; due_date?: string | null; task_id?: string | null },
): Promise<StrategyWrite & { action?: RetroActionRow }> {
  const res = await supabase.from('retro_actions').update(patch).eq('id', actionId).select(RETRO_ACTION_COLUMNS)
  return { outcome: await classifyWrite(res), action: res.data?.[0] }
}

export async function deleteRetroAction(supabase: Client, actionId: string): Promise<StrategyWrite> {
  const res = await supabase.from('retro_actions').delete().eq('id', actionId).select('id')
  return { outcome: await classifyWrite(res) }
}

/* ── Conversion to canonical work ─────────────────────────────────────────────────── */

export interface WorkItemSeed {
  // ⚠️ NO board_id. `tasks` has no such column - a task's board is derived from its column, and
  // sending one is a PGRST204 that surfaces as a conversion which reports nothing and does
  // nothing. It was in this interface for one round of the browser harness, discarded by
  // PostgREST rather than by us, which is precisely the "present and believed" shape this
  // codebase keeps paying for. The caller resolves the column; the column names the board.
  column_id: string
  title: string
  description?: string | null
  assigned_to?: string | null
  due_date?: string | null
  type_key?: string
  status?: string | null
}

/**
 * Create a real work item, for an idea or a retrospective action.
 *
 * ⚠️ Four fields here are not optional, and every one of them was found by a failing harness
 * rather than by reading:
 *
 *   `status`     - `enforce_task_lifecycle` REWRITES `column_id` on insert when `tasks.status`
 *                  (default 'to_do') disagrees with the target column's status_key, so a task
 *                  seeded by column alone silently lands somewhere else entirely.
 *   `position`   - NOT NULL with no default. Omitting it is a 400, which surfaces as a
 *                  conversion that reports nothing and does nothing.
 *   `visibility` - the column DEFAULTS to 'assigned', and an assigned-visibility task with no
 *                  assignee is visible to ITS CREATOR ALONE. A retrospective action the team
 *                  agreed on, converted into work only the converter can see, is worse than
 *                  not converting it: everyone else believes it was captured.
 *   `due_date`   - `tasks.due_date` is TIMESTAMPTZ, not DATE, and this repo has shipped the
 *                  resulting off-by-one day five-plus times. Every writer goes through
 *                  `dueDateForStorage`, so this column holds ONE shape.
 */
export async function createWorkItem(
  supabase: Client, seed: WorkItemSeed, userId: string | null,
): Promise<StrategyWrite & { task?: { id: string; title: string } }> {
  const { due_date, ...rest } = seed
  const res = await supabase
    .from('tasks')
    .insert({
      type_key: 'task',
      position: 0,
      visibility: 'board',
      ...rest,
      due_date: dueDateForStorage(due_date ?? null),
      created_by: userId,
    })
    .select('id, title')
  return { outcome: await classifyWrite(res), task: res.data?.[0] }
}

export { didWrite, writeFailureMessage } from './rls-write'
