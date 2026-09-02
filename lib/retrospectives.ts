// Retrospectives - templates, grouping, voting, and what the anonymity promise actually is.
//
// ⚠️ RETRO_TEMPLATE_COLUMNS MIRRORS private.retro_template_columns() IN MIGRATION 132, and it
// is a mirror rather than the source: the database refuses a note filed under a column the
// template does not have, because a note stored where nothing renders it is invisible, and
// "hidden from you" and "does not exist" arriving identical is this repo's most expensive
// recurring shape. scripts/check-strategy.mjs writes EVERY key declared below against the real
// database plus one bogus key, so the two cannot drift without a harness failing. That harness
// is the parity gate; this comment is not.
//
// No React, no Supabase.

export type RetroTemplate = 'what_went_well' | 'start_stop_continue' | 'four_ls' | 'plain'
export type RetroState = 'open' | 'closed'

export const RETRO_TEMPLATES: RetroTemplate[] = ['what_went_well', 'start_stop_continue', 'four_ls', 'plain']

export const RETRO_TEMPLATE_LABELS: Record<RetroTemplate, string> = {
  what_went_well: 'What went well',
  start_stop_continue: 'Start, stop, continue',
  four_ls: 'Liked, learned, lacked, longed for',
  plain: 'One list',
}

export const RETRO_TEMPLATE_HELP: Record<RetroTemplate, string> = {
  what_went_well: 'The plain one. Three columns: what worked, what did not, and what to try.',
  start_stop_continue: 'Focused on behaviour rather than events. Good when the same problem keeps returning.',
  four_ls: 'Slower and more reflective. Good after something big finished, or went badly.',
  plain: 'A single list, no structure. Good for a five-minute check-in.',
}

/** Must match private.retro_template_columns() key for key. */
export const RETRO_TEMPLATE_COLUMNS: Record<RetroTemplate, string[]> = {
  what_went_well: ['well', 'not_well', 'ideas'],
  start_stop_continue: ['start', 'stop', 'continue'],
  four_ls: ['liked', 'learned', 'lacked', 'longed_for'],
  plain: ['notes'],
}

// Internal: reached through retroColumnLabel(), which is the only thing that should ever
// resolve a key, so an unknown one renders as itself rather than blank.
const RETRO_COLUMN_LABELS: Record<string, string> = {
  well: 'What went well',
  not_well: 'What did not',
  ideas: 'What to try',
  start: 'Start doing',
  stop: 'Stop doing',
  continue: 'Keep doing',
  liked: 'Liked',
  learned: 'Learned',
  lacked: 'Lacked',
  longed_for: 'Longed for',
  notes: 'Notes',
}

export function retroColumns(template: RetroTemplate): string[] {
  return RETRO_TEMPLATE_COLUMNS[template] ?? RETRO_TEMPLATE_COLUMNS.plain
}

export function retroColumnLabel(key: string): string {
  return RETRO_COLUMN_LABELS[key] ?? key
}

/**
 * ⚠️ What anonymity here does and does not promise, in the words the product uses.
 *
 * The first half is enforced by the database: the author of a note on an anonymous retro is
 * written to a table `authenticated` holds no privilege on at all, and `retro_notes.author_id`
 * is NULL. The second half cannot be enforced by anything, and saying so is the difference
 * between a feature people can calibrate their trust against and one they over-trust once.
 */
export const ANONYMITY_PROMISE =
  'Nobody can look up who wrote an anonymous note, including admins and including through the database. You can still edit and delete your own.'

export const ANONYMITY_RESIDUAL =
  'One thing no setting can fix: if people are watching the board while notes appear, the order they appear in can give someone away. If that matters, write notes before the session rather than during it.'

export interface RetrospectiveRow {
  id: string
  board_id: string
  sprint_id?: string | null
  title: string
  template: RetroTemplate
  is_anonymous: boolean
  state: RetroState
  held_on?: string | null
  created_by?: string | null
  created_at: string
}

export interface RetroNoteRow {
  id: string
  retro_id: string
  column_key: string
  body: string
  group_id?: string | null
  position?: number | null
  author_id?: string | null
  vote_count: number
  created_at: string
}

export interface RetroGroupRow {
  id: string
  retro_id: string
  title: string
  position?: number | null
}

export interface RetroActionRow {
  id: string
  retro_id: string
  note_id?: string | null
  body: string
  owner_id?: string | null
  due_date?: string | null
  task_id?: string | null
  converted_at?: string | null
  created_at: string
}

/**
 * Notes for one column, most-voted first.
 *
 * ⚠️ The tie-break is creation order, NOT author or id. On an anonymous retro any ordering
 * derived from who wrote a note would leak exactly what the feature exists to hide, and a
 * stable sort by an opaque uuid is the kind of thing that looks harmless and correlates.
 */
export function notesForColumn(notes: RetroNoteRow[], columnKey: string): RetroNoteRow[] {
  return notes
    .filter((n) => n.column_key === columnKey)
    .sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at))
}

export interface GroupedNotes {
  group: RetroGroupRow | null
  notes: RetroNoteRow[]
  votes: number
}

/**
 * Notes gathered into their themes, ungrouped ones last.
 *
 * A group's weight is the SUM of its notes' votes, which is the whole reason grouping exists:
 * five people each writing a slightly different sentence about the same problem is a strong
 * signal that reads as five weak ones until they are gathered.
 */
export function groupNotes(notes: RetroNoteRow[], groups: RetroGroupRow[]): GroupedNotes[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const buckets = new Map<string, RetroNoteRow[]>()
  const loose: RetroNoteRow[] = []

  for (const note of notes) {
    // A group_id pointing at a group this viewer did not receive means the group row was
    // filtered, not that the note is ungrouped. Both land in "no theme", and that is stated
    // rather than silently equated: 132 scopes groups to the same retro, so in practice the
    // only way here is a partial read.
    if (note.group_id && byId.has(note.group_id)) {
      const list = buckets.get(note.group_id) ?? []
      list.push(note)
      buckets.set(note.group_id, list)
    } else {
      loose.push(note)
    }
  }

  const grouped: GroupedNotes[] = [...buckets.entries()].map(([id, list]) => ({
    group: byId.get(id) as RetroGroupRow,
    notes: list.sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at)),
    votes: list.reduce((sum, n) => sum + n.vote_count, 0),
  }))

  grouped.sort((a, b) => b.votes - a.votes || (a.group?.position ?? 0) - (b.group?.position ?? 0))

  if (loose.length > 0) {
    grouped.push({
      group: null,
      notes: loose.sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at)),
      votes: loose.reduce((sum, n) => sum + n.vote_count, 0),
    })
  }
  return grouped
}

/**
 * What a person may do here, mirroring 132's policies.
 *
 * ⚠️ `canEditNote` reads `myNoteIds`, which comes from public.my_retro_note_ids() - a
 * SECURITY DEFINER function returning only the caller's OWN ids. It is deliberately not
 * derived from `author_id`, which is NULL on every anonymous note: doing that would have made
 * anonymous notes uneditable by their own authors, a UI stricter than its policy, which takes
 * an ability away from exactly the people the design was built to serve.
 */
export function canEditNote(note: RetroNoteRow, myNoteIds: ReadonlySet<string>, retro: RetrospectiveRow): boolean {
  return retro.state === 'open' && myNoteIds.has(note.id)
}

export function canDeleteNote(
  note: RetroNoteRow,
  myNoteIds: ReadonlySet<string>,
  isAdmin: boolean,
): boolean {
  // An admin may remove a note but never edit it. Rewriting somebody's retrospective note and
  // leaving it standing as theirs is worse than deleting it, and 132's policies say the same.
  return myNoteIds.has(note.id) || isAdmin
}

/** The reason a control is unavailable, or null when it is available. Prompt B's UX rule. */
export function retroBlockedReason(retro: RetrospectiveRow | null): string | null {
  if (!retro) return 'Pick or create a retrospective first.'
  if (retro.state === 'closed') return 'This retrospective is closed. Its notes and votes are the record of what was said.'
  return null
}

export interface RetroSummary {
  notes: number
  votes: number
  actions: number
  convertedActions: number
  topThemes: GroupedNotes[]
}

export function summarizeRetro(
  notes: RetroNoteRow[],
  groups: RetroGroupRow[],
  actions: RetroActionRow[],
): RetroSummary {
  const grouped = groupNotes(notes, groups).filter((g) => g.group !== null)
  return {
    notes: notes.length,
    votes: notes.reduce((sum, n) => sum + n.vote_count, 0),
    actions: actions.length,
    convertedActions: actions.filter((a) => a.converted_at).length,
    topThemes: grouped.slice(0, 3),
  }
}
