// Command registry for the ⌘K palette.
//
// The interaction principle is the one the plan takes from Plane's Power-K: one keyboard
// surface that navigates, searches, creates, and acts on whatever you currently have
// open - so small changes stop requiring a trip through menus.
//
// Every command carries the CapabilityDecision that authorises it, and `runCommand`
// refuses to execute a denied one. That is the plan's "Register commands through the
// Atlas permission system / unavailable commands must not execute" requirement: a
// palette is a second route to every action in the product, and a second route is
// exactly where a permission check gets forgotten.
//
// Pure and framework-free (no React, no router) so the visibility and execution rules
// are unit-testable - same split as nav-model.ts.

import type { CapabilityDecision } from '@/lib/capabilities'
import type { NavGroup } from './nav-model'
import type { RecentRecord } from './recent-records'

/** Palette sections, in render order. */
export type CommandGroupId = 'favorite' | 'recent' | 'navigate' | 'search' | 'create' | 'context'

export const COMMAND_GROUP_LABELS: Record<CommandGroupId, string> = {
  favorite: 'Favourites',
  recent: 'Recent',
  navigate: 'Go to',
  search: 'Search results',
  create: 'Create',
  context: 'This board',
}

// Favourites lead: they are the one section the user curated by hand, so they should be the
// first thing under the cursor when the palette opens empty. Recent follows, being the
// app's guess rather than the user's instruction.
export const COMMAND_GROUP_ORDER: readonly CommandGroupId[] = [
  'favorite',
  'recent',
  'navigate',
  'search',
  'create',
  'context',
] as const

export interface Command {
  id: string
  group: CommandGroupId
  label: string
  /** Secondary line - a board name, a status, why the command is unavailable. */
  hint?: string
  /** Icon key resolved by nav-icons.ts. */
  icon: string
  /** Extra terms the fuzzy match should consider (cmdk matches on `value`). */
  keywords?: string[]
  /** Navigation target. Mutually exclusive with `run` in practice; `href` wins. */
  href?: string
  /** Host-supplied side effect (open a dialog, copy a link). */
  run?: () => void
  /**
   * Authorisation for this command. Omitted means "always available" - used for pure
   * navigation, where RLS decides what the destination actually shows.
   */
  decision?: CapabilityDecision
}

/** A command as the palette should draw it, after permissions are applied. */
export interface ResolvedCommand extends Command {
  disabled: boolean
  /** Present only when the command is visible but unavailable. */
  unavailableReason?: string
}

export interface CommandGroup {
  id: CommandGroupId
  label: string
  commands: ResolvedCommand[]
}

/**
 * Apply permissions.
 *
 *   allowed        → enabled
 *   denied/hide    → dropped; the role has no path to it and listing it is noise
 *   denied/explain → listed but inert, carrying the reason
 *
 * Keeping the "explain" case visible is deliberate: a command that silently vanishes is
 * indistinguishable from one that is broken or that the user simply failed to find.
 */
export function resolveCommands(commands: Command[]): ResolvedCommand[] {
  const resolved: ResolvedCommand[] = []
  for (const command of commands) {
    const decision = command.decision
    if (!decision || decision.allowed) {
      resolved.push({ ...command, disabled: false })
      continue
    }
    if (decision.presentation === 'hide' || !decision.reason) continue
    resolved.push({ ...command, disabled: true, unavailableReason: decision.reason })
  }
  return resolved
}

/** Group resolved commands for rendering, dropping any section left empty. */
export function groupCommands(commands: Command[]): CommandGroup[] {
  const resolved = resolveCommands(commands)
  return COMMAND_GROUP_ORDER.map((id) => ({
    id,
    label: COMMAND_GROUP_LABELS[id],
    commands: resolved.filter((c) => c.group === id),
  })).filter((group) => group.commands.length > 0)
}

/**
 * Execute a command. Returns false when nothing ran, so the caller knows to leave the
 * palette open rather than dismissing it on a no-op.
 *
 * A denied command is refused here as well as hidden/disabled in the UI - the guard has
 * to live at the point of execution, because that is the one place every route into the
 * command converges. RLS remains the actual authority over the write that follows.
 */
export function runCommand(
  command: Command | ResolvedCommand,
  navigate: (href: string) => void,
): boolean {
  if (command.decision && !command.decision.allowed) return false
  if (command.href) {
    navigate(command.href)
    return true
  }
  if (command.run) {
    command.run()
    return true
  }
  return false
}

/**
 * Turn the shell's nav model into navigation commands. The palette and the sidebar draw
 * from the same already-filtered groups, so a module a super_admin switched off cannot
 * reappear as a keyboard shortcut.
 */
export function buildNavigationCommands(groups: NavGroup[]): Command[] {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      id: `nav:${item.id}`,
      group: 'navigate' as const,
      label: item.label,
      hint: item.status === 'planned' ? 'Coming soon' : group.label,
      icon: item.icon,
      keywords: [group.label],
      href: item.href,
    })),
  )
}

/**
 * Starred boards - the palette's "the things I always come back to" section.
 *
 * Takes already-resolved favourites (see lib/favorites.ts::resolveFavorites), so a star
 * pointing at a board the viewer can no longer open never reaches the palette. That matters
 * more here than in the sidebar: the palette is a search surface, and a hit for a board name
 * you cannot open would leak the name.
 */
export function buildFavoriteCommands(
  favorites: ReadonlyArray<{ key: string; label: string; href: string }>,
  limit = 6,
): Command[] {
  return favorites.slice(0, limit).map((favorite) => ({
    id: `favorite:${favorite.key}`,
    group: 'favorite' as const,
    label: favorite.label,
    hint: 'Favourite',
    icon: 'star',
    keywords: ['favourite', 'favorite', 'starred'],
    href: favorite.href,
  }))
}

/** Recently viewed records, newest first - the palette's "where was I?" section. */
export function buildRecentCommands(records: RecentRecord[], limit = 5): Command[] {
  return records.slice(0, limit).map((record) => ({
    id: `recent:${record.key}`,
    group: 'recent' as const,
    label: record.label,
    hint: record.kind === 'board' ? 'Board' : record.kind === 'task' ? 'Task' : 'View',
    icon: record.kind === 'board' ? 'kanban' : 'inbox-check',
    href: record.href,
  }))
}
