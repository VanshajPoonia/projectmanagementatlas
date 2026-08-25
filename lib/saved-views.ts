// Saved views - storing "how I like to look at this work" so it survives a navigation.
//
// Prompt E: "A saved view stores: layout, scope, descendant behavior, filters, sort, grouping,
// visible fields, density. Scopes: personal, shared."
//
// The config itself is lib/view-config.ts. This file is the record around it: who owns it, who
// can see it, and the writes - which all count their returned rows, because an RLS refusal on
// this table comes back as zero rows and no error, exactly as it did for board_members.
//
// ⚠️ PERSONAL VIEWS ARE PRIVATE, INCLUDING FROM ADMINS. 119's SELECT policy has no admin term
// and a post-condition asserts it stays that way. A saved view is a note about how somebody
// likes to work, and it sits with task_reminders on the short list of things this app
// deliberately does not let an admin read. Any UI here that appears to offer an admin "all
// views" is therefore showing shared ones only, and must say so rather than implying it is
// showing everything (the hidden-vs-does-not-exist trap).

import {
  normalizeViewConfig,
  serializeViewConfig,
  type ViewConfig,
} from './view-config'
import { classifyWrite, didWrite, writeFailureMessage, type WriteOutcome } from './rls-write'

export type ViewScope = 'personal' | 'shared'

export interface SavedView {
  id: string
  name: string
  description: string | null
  scope: ViewScope
  ownerId: string
  boardId: string | null
  config: ViewConfig
  createdAt: string
  updatedAt: string
}

/** The columns every read of this table asks for, in one place so they cannot drift apart. */
export const SAVED_VIEW_SELECT =
  'id, name, description, scope, owner_id, board_id, config, created_at, updated_at'

export function mapSavedView(row: any): SavedView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    scope: row.scope === 'shared' ? 'shared' : 'personal',
    ownerId: row.owner_id,
    boardId: row.board_id ?? null,
    config: normalizeViewConfig(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/* ── Pure helpers ──────────────────────────────────────────────────────────────────── */

export interface ViewGroupings {
  personal: SavedView[]
  shared: SavedView[]
}

/**
 * Split for a picker. Personal first because it is the shorter, more relevant list - the views
 * someone made for themselves are the ones they reach for.
 */
export function groupViews(views: readonly SavedView[], currentUserId: string | null): ViewGroupings {
  const byName = (a: SavedView, b: SavedView) => a.name.localeCompare(b.name)
  return {
    personal: views.filter((v) => v.scope === 'personal' && v.ownerId === currentUserId).sort(byName),
    shared: views.filter((v) => v.scope === 'shared').sort(byName),
  }
}

/** The views that apply on a given board: that board's own, plus every cross-board view. */
export function viewsForBoard(views: readonly SavedView[], boardId: string | null): SavedView[] {
  return views.filter((v) => v.boardId === null || v.boardId === boardId)
}

/** Only the owner may rename, re-scope or delete; an admin may additionally manage shared ones. */
export function canManageView(view: SavedView, userId: string | null, isAdmin: boolean): boolean {
  if (userId && view.ownerId === userId) return true
  return isAdmin && view.scope === 'shared'
}

/**
 * ATLAS_01 10.2 - say WHY, do not just disable. Returns null when management is allowed.
 */
export function manageBlockedReason(view: SavedView, userId: string | null, isAdmin: boolean): string | null {
  if (canManageView(view, userId, isAdmin)) return null
  if (view.scope === 'shared') return 'Only the person who created this shared view, or an admin, can change it.'
  return 'This is someone else\'s personal view.'
}

/**
 * 119 deliberately has no UNIQUE (owner_id, name) - see its header for why a UNIQUE over a
 * nullable board_id would not mean what it looks like. So the warning lives here instead.
 */
export function duplicateNameWarning(
  views: readonly SavedView[],
  name: string,
  scope: ViewScope,
  boardId: string | null,
  excludeId?: string,
): string | null {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed) return null
  const clash = views.some(
    (v) =>
      v.id !== excludeId &&
      v.scope === scope &&
      v.boardId === boardId &&
      v.name.trim().toLowerCase() === trimmed,
  )
  return clash ? `A ${scope} view called "${name.trim()}" already exists here.` : null
}

export function validateViewName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the view a name.'
  if (trimmed.length > 120) return 'Keep the name under 120 characters.'
  return null
}

/**
 * A shared view must not depend on who is looking in a way its author did not intend - except
 * via @me, which is the whole point of that sentinel. Nothing to validate there; the note exists
 * so the next person does not "fix" @me into a stored uuid on save.
 */

/* ── Writes ────────────────────────────────────────────────────────────────────────── */

export interface SaveViewInput {
  name: string
  description?: string | null
  scope: ViewScope
  boardId: string | null
  config: ViewConfig
}

export interface SaveViewResult {
  outcome: WriteOutcome
  view: SavedView | null
  /** The sentence to show, or null when it worked. */
  message: { title: string; description: string } | null
}

export async function createSavedView(
  supabase: any,
  ownerId: string,
  input: SaveViewInput,
): Promise<SaveViewResult> {
  const result = await supabase
    .from('saved_views')
    .insert({
      owner_id: ownerId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      scope: input.scope,
      board_id: input.boardId,
      config: serializeViewConfig(input.config),
    })
    .select(SAVED_VIEW_SELECT)

  const outcome = await classifyWrite(result)
  return {
    outcome,
    view: didWrite(outcome) && result.data?.[0] ? mapSavedView(result.data[0]) : null,
    message: writeFailureMessage(outcome, 'view'),
  }
}

export async function updateSavedView(
  supabase: any,
  viewId: string,
  patch: Partial<SaveViewInput>,
): Promise<SaveViewResult> {
  const payload: Record<string, unknown> = {}
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.description !== undefined) payload.description = patch.description?.trim() || null
  if (patch.scope !== undefined) payload.scope = patch.scope
  if (patch.boardId !== undefined) payload.board_id = patch.boardId
  if (patch.config !== undefined) payload.config = serializeViewConfig(patch.config)

  const result = await supabase
    .from('saved_views')
    .update(payload)
    .eq('id', viewId)
    .select(SAVED_VIEW_SELECT)

  // Re-scoping personal -> shared cannot hide the row from its owner (the SELECT policy's
  // owner_id branch always matches), so no visibility probe is needed. Going shared ->
  // personal likewise. The only caller who could lose sight of a row is an ADMIN editing a
  // shared view into a personal one, which the UPDATE policy's WITH CHECK refuses outright.
  const outcome = await classifyWrite(result)
  return {
    outcome,
    view: didWrite(outcome) && result.data?.[0] ? mapSavedView(result.data[0]) : null,
    message: writeFailureMessage(outcome, 'view'),
  }
}

export async function deleteSavedView(supabase: any, viewId: string): Promise<SaveViewResult> {
  const result = await supabase.from('saved_views').delete().eq('id', viewId).select('id')
  const outcome = await classifyWrite(result)
  return { outcome, view: null, message: writeFailureMessage(outcome, 'view') }
}

export async function loadSavedViews(supabase: any): Promise<{ views: SavedView[]; error: string | null }> {
  const { data, error } = await supabase
    .from('saved_views')
    .select(SAVED_VIEW_SELECT)
    .order('name')

  if (error) return { views: [], error: error.message }
  return { views: (data ?? []).map(mapSavedView), error: null }
}
