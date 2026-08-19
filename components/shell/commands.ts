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

import { isModuleEnabled, type AppModule } from '@/lib/module-registry'
import type { CapabilityDecision } from '@/lib/capabilities'
import type { NavGroup, Role } from './nav-model'
import type { RecentRecord } from './recent-records'
import { dashboardHost } from './workspace-nav'

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

/**
 * The palette's Create section.
 *
 * ⚠️ Two defects lived in the copies this replaces, and both are the kind that only show
 * up for the people who actually use the product:
 *
 *   1. my-work-view.tsx hardcoded '/dashboard?tab=boards'. app/dashboard/page.tsx
 *      redirects an admin to /admin and DROPS the query string, so for every admin - which
 *      per CLAUDE.md is all five real users - both Create commands landed on whatever tab
 *      they last had open. `dashboardHost` is shared with the sidebar so the two cannot
 *      drift again.
 *   2. admin-dashboard.tsx and crm-shell.tsx passed no commands at all, so the Create
 *      section simply did not exist on the screens an admin lands on.
 *
 * Module-gated, because offering "New personal task" when `personal_tasks` is switched off
 * is a link to a tab that is no longer there.
 */
export function buildCreateCommands({
  role,
  modules,
}: {
  role: Role
  modules: AppModule[]
}): Command[] {
  const host = dashboardHost(role)
  const commands: Command[] = []

  if (isModuleEnabled(modules, 'boards')) {
    commands.push({
      id: 'create:board-task',
      group: 'create',
      label: 'New task on a board',
      hint: 'Opens Boards',
      icon: 'plus',
      keywords: ['task', 'work item', 'add'],
      href: `${host}?tab=boards`,
    })
  }
  if (isModuleEnabled(modules, 'personal_tasks')) {
    commands.push({
      id: 'create:personal-task',
      group: 'create',
      label: 'New personal task',
      hint: 'Private to you',
      icon: 'plus',
      keywords: ['personal', 'todo', 'add'],
      href: `${host}?tab=personal`,
    })
  }

  return commands
}

/**
 * Priority is a bare 1-5 integer on `tasks`, and the only place its meaning was written
 * down was a hardcoded <SelectItem> list inside task-card.tsx. Naming it here lets the
 * palette say "Set priority: High" instead of "Set priority: 2".
 */
export const TASK_PRIORITIES: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Highest' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
  { value: 5, label: 'Lowest' },
] as const

export interface BoardContextOptions {
  boardTitle: string
  /** Decisions come from lib/capabilities.ts; a denied command is dropped or made inert. */
  createDecision: CapabilityDecision
  manageDecision: CapabilityDecision
  membersDecision: CapabilityDecision
  onCreate: () => void
  onFilter: () => void
  onOpenSettings: () => void
  onCopyLink: () => void
}

/**
 * The palette's project-context actions, from the plan's Prompt A list:
 * open saved view · create work · filter · open members/settings if permitted.
 *
 * "Open saved view" is deliberately absent rather than stubbed: saved views are Prompt E
 * and do not exist yet, and a command that opens nothing is worse than one that is not
 * offered. The rest are all reachable today.
 *
 * Every command carries its CapabilityDecision, so `resolveCommands` drops the ones this
 * role has no path to and leaves the explainable ones visible but inert.
 */
export function buildBoardContextCommands(options: BoardContextOptions): Command[] {
  return [
    {
      id: 'context:create-task',
      group: 'context',
      label: 'Create work item',
      hint: options.boardTitle,
      icon: 'plus',
      keywords: ['new', 'task', 'add'],
      run: options.onCreate,
      decision: options.createDecision,
    },
    {
      id: 'context:filter',
      group: 'context',
      label: 'Filter this board',
      hint: 'Assignee, priority, due date',
      icon: 'filter',
      keywords: ['search', 'narrow', 'sort'],
      run: options.onFilter,
    },
    {
      id: 'context:members',
      group: 'context',
      label: 'Manage who has access',
      icon: 'users',
      keywords: ['members', 'permissions', 'share', 'guest', 'client'],
      run: options.onOpenSettings,
      decision: options.membersDecision,
    },
    {
      id: 'context:settings',
      group: 'context',
      label: 'Board settings',
      icon: 'settings',
      keywords: ['rename', 'colour', 'color', 'columns'],
      run: options.onOpenSettings,
      decision: options.manageDecision,
    },
    {
      id: 'context:copy-board-link',
      group: 'context',
      label: 'Copy link to this board',
      icon: 'link',
      keywords: ['url', 'share'],
      run: options.onCopyLink,
    },
  ]
}

export interface WorkItemContextOptions {
  task: { id: string; title: string; priority?: number | null; parentId?: string | null }
  /** The board's columns, so "move to" offers real destinations rather than free text. */
  columns: readonly { id: string; title: string }[]
  currentColumnId?: string | null
  /** `task.edit` for this task - the gate on every mutating command below. */
  editDecision: CapabilityDecision
  onMoveToColumn: (columnId: string) => void
  onSetPriority: (priority: number) => void
  onOpenAssignees: () => void
  onOpenLabels: () => void
  onCopyLink: () => void
  onOpenParent: () => void
  onOpenBoard: () => void
}

/**
 * The palette's work-item-context actions, from the plan's Prompt A list:
 * change state · change priority · assign · add/remove label · copy link · open parent ·
 * open project.
 *
 * State and priority are emitted one command per value ("Move to: In Progress"), which is
 * how a flat palette expresses a choice - a command that opens a dropdown would just be a
 * slower version of clicking the card.
 *
 * ⚠️ Assign and label deliberately OPEN the task's own controls rather than writing
 * inline. Assignment fans out into task_assignees, the assigned_to mirror, a notification
 * row and an email; reproducing that here would be a fourth copy of a rule this codebase
 * has already been bitten by having three copies of. The palette's job is to get you to
 * the control without leaving the keyboard, not to own a second write path.
 */
export function buildWorkItemContextCommands(options: WorkItemContextOptions): Command[] {
  const { task, editDecision } = options
  const commands: Command[] = []

  for (const column of options.columns) {
    if (column.id === options.currentColumnId) continue
    commands.push({
      id: `context:move:${column.id}`,
      group: 'context',
      label: `Move to: ${column.title}`,
      hint: task.title,
      icon: 'kanban',
      keywords: ['state', 'status', 'column', column.title],
      run: () => options.onMoveToColumn(column.id),
      decision: editDecision,
    })
  }

  for (const priority of TASK_PRIORITIES) {
    if (priority.value === task.priority) continue
    commands.push({
      id: `context:priority:${priority.value}`,
      group: 'context',
      label: `Set priority: ${priority.label}`,
      hint: task.title,
      icon: 'flag',
      keywords: ['priority', 'urgency', String(priority.value)],
      run: () => options.onSetPriority(priority.value),
      decision: editDecision,
    })
  }

  commands.push(
    {
      id: 'context:assign',
      group: 'context',
      label: 'Assign this work item',
      hint: task.title,
      icon: 'users',
      keywords: ['assignee', 'owner', 'who'],
      run: options.onOpenAssignees,
      decision: editDecision,
    },
    {
      id: 'context:labels',
      group: 'context',
      label: 'Add or remove a label',
      hint: task.title,
      icon: 'tag',
      keywords: ['tag', 'label'],
      run: options.onOpenLabels,
      decision: editDecision,
    },
    {
      id: 'context:copy-task-link',
      group: 'context',
      label: 'Copy link to this work item',
      icon: 'link',
      keywords: ['url', 'share'],
      run: options.onCopyLink,
    },
    {
      id: 'context:open-board',
      group: 'context',
      label: 'Open the project board',
      icon: 'kanban',
      keywords: ['project', 'board', 'parent'],
      run: options.onOpenBoard,
    },
  )

  // Only offered when there is a parent to open - a command that navigates nowhere is the
  // same defect as the saved-view stub this builder refuses to emit.
  if (task.parentId) {
    commands.push({
      id: 'context:open-parent',
      group: 'context',
      label: 'Open the parent work item',
      icon: 'inbox-check',
      keywords: ['parent', 'up'],
      run: options.onOpenParent,
    })
  }

  return commands
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
