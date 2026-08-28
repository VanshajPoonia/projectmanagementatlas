// Which My Work sections a person sees, and in what order.
//
// ⚠️ localStorage, not a table, and that is a rule rather than a shortcut: presentational
// preferences do not earn schema in this repo (stated when 097 added user_favorites, and
// applied again to theme, accent, density, sidebar collapse and the marketing calendar
// choice). "Which sections I like on my dashboard" changes nothing anyone else can see and
// nothing any report reads.
//
// The corollary the plan states directly: one person's display preference must never change
// anybody else's workspace. There is deliberately no way to set these for someone else.
//
// Pure functions here; the storage read/write lives in the hook next to it, because
// `localStorage` under vitest is a Node 22 stub that silently swallows everything (see
// marketing-calendar.test.tsx's header).

/**
 * Every section, in the order a new person gets them.
 *
 * The order is an argument, not an accident: what can I not act on (blocked, awaiting
 * approval) and what is already late comes before what is merely scheduled, and the complete
 * "assigned to me" list is last because it repeats everything above it.
 */
export const MY_WORK_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'recommended-next', label: 'What to do next' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'blocked', label: 'Blocked by others' },
  { id: 'awaiting-approval', label: 'Waiting on approval' },
  { id: 'blocking', label: 'Blocking others' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'this-week', label: 'Upcoming' },
  { id: 'delegated', label: 'Waiting on someone else' },
  { id: 'personal', label: 'Personal tasks' },
  { id: 'recent', label: 'Recently viewed' },
  { id: 'assigned', label: 'Assigned to me' },
]

export const MY_WORK_SECTION_IDS: readonly string[] = MY_WORK_SECTIONS.map((s) => s.id)

export interface MyWorkPreferences {
  /** Section ids, in display order. Always exactly the known ids, no more and no fewer. */
  order: string[]
  /** Section ids the person has switched off. */
  hidden: string[]
}

export const DEFAULT_PREFERENCES: MyWorkPreferences = {
  order: [...MY_WORK_SECTION_IDS],
  hidden: [],
}

export function myWorkPreferencesKey(userId: string): string {
  return `atlas:my-work-sections:${userId}`
}

/**
 * Read stored preferences, repairing anything that no longer makes sense.
 *
 * ⚠️ Never throws and never returns a partial list. A stored order is data written by an older
 * version of this file: it can name a section that has since been removed, and it can be
 * missing one that has since been added. A renamed section that silently disappeared from
 * everyone's page - with no error and no way to discover it - is exactly the failure this
 * repair exists to prevent, so unknown ids are dropped and missing ones are appended in their
 * default position.
 */
export function parseMyWorkPreferences(raw: string | null | undefined): MyWorkPreferences {
  if (!raw) return { ...DEFAULT_PREFERENCES, order: [...MY_WORK_SECTION_IDS] }

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_PREFERENCES, order: [...MY_WORK_SECTION_IDS] }
  }

  const known = new Set(MY_WORK_SECTION_IDS)
  const storedOrder: string[] = Array.isArray(parsed?.order) ? parsed.order.filter((id: unknown) => typeof id === 'string') : []

  const order: string[] = []
  const seen = new Set<string>()
  for (const id of storedOrder) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  // Anything the stored list has never heard of goes back where the default puts it, rather
  // than all at the end: a section added above "Assigned to me" belongs above it for everyone.
  for (let i = 0; i < MY_WORK_SECTION_IDS.length; i++) {
    const id = MY_WORK_SECTION_IDS[i]
    if (seen.has(id)) continue
    order.splice(Math.min(i, order.length), 0, id)
    seen.add(id)
  }

  const hidden = (Array.isArray(parsed?.hidden) ? parsed.hidden : [])
    .filter((id: unknown): id is string => typeof id === 'string' && known.has(id))

  return { order, hidden: [...new Set<string>(hidden)] }
}

export function serializeMyWorkPreferences(preferences: MyWorkPreferences): string {
  return JSON.stringify({ order: preferences.order, hidden: preferences.hidden })
}

export function isSectionVisible(preferences: MyWorkPreferences, id: string): boolean {
  return !preferences.hidden.includes(id)
}

/** Switch one section on or off. Returns a new object; never mutates. */
export function toggleSection(preferences: MyWorkPreferences, id: string): MyWorkPreferences {
  if (!MY_WORK_SECTION_IDS.includes(id)) return preferences
  const hidden = preferences.hidden.includes(id)
    ? preferences.hidden.filter((entry) => entry !== id)
    : [...preferences.hidden, id]
  return { ...preferences, hidden }
}

/**
 * Move a section up (-1) or down (+1).
 *
 * A no-op at either end rather than a wrap-around: a control that jumps the top item to the
 * bottom looks like a bug every time somebody clicks it once too often.
 */
export function moveSection(preferences: MyWorkPreferences, id: string, delta: number): MyWorkPreferences {
  const from = preferences.order.indexOf(id)
  if (from < 0) return preferences
  const to = from + delta
  if (to < 0 || to >= preferences.order.length) return preferences

  const order = [...preferences.order]
  order.splice(from, 1)
  order.splice(to, 0, id)
  return { ...preferences, order }
}

export function resetMyWorkPreferences(): MyWorkPreferences {
  return { order: [...MY_WORK_SECTION_IDS], hidden: [] }
}

/**
 * Put a set of built sections into the person's order, dropping the ones they hid.
 *
 * Generic over anything with an `id`, so the same function orders the task sections and the
 * two synthetic ones ("What to do next" and "Recently viewed") that are not lists of tasks.
 */
export function applyPreferences<T extends { id: string }>(
  sections: readonly T[],
  preferences: MyWorkPreferences,
): T[] {
  const rank = new Map(preferences.order.map((id, index) => [id, index]))
  return sections
    .filter((section) => isSectionVisible(preferences, section.id))
    .slice()
    .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
}
