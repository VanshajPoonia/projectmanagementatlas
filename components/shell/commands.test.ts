import { describe, it, expect, vi } from 'vitest'
import {
  COMMAND_GROUP_ORDER,
  TASK_PRIORITIES,
  buildBoardContextCommands,
  buildCreateCommands,
  buildWorkItemContextCommands,
  buildFavoriteCommands,
  buildNavigationCommands,
  buildRecentCommands,
  groupCommands,
  resolveCommands,
  runCommand,
  type Command,
} from './commands'
import type { CapabilityDecision } from '@/lib/capabilities'
import type { NavGroup } from './nav-model'
import type { RecentRecord } from './recent-records'

const ALLOWED: CapabilityDecision = { allowed: true, presentation: 'allow' }
const HIDDEN: CapabilityDecision = { allowed: false, presentation: 'hide' }
const EXPLAINED: CapabilityDecision = {
  allowed: false,
  presentation: 'explain',
  reason: 'Guest access can open this board but not change its work.',
}

function command(over: Partial<Command> = {}): Command {
  return { id: 'c', group: 'create', label: 'Create work item', icon: 'kanban', ...over }
}

describe('resolveCommands', () => {
  it('keeps an allowed command enabled', () => {
    const [resolved] = resolveCommands([command({ decision: ALLOWED })])
    expect(resolved.disabled).toBe(false)
    expect(resolved.unavailableReason).toBeUndefined()
  })

  it('keeps an unauthorised command with no decision at all (pure navigation)', () => {
    expect(resolveCommands([command({ decision: undefined })])).toHaveLength(1)
  })

  it('drops a hidden command entirely', () => {
    expect(resolveCommands([command({ decision: HIDDEN })])).toEqual([])
  })

  // A command that silently vanishes is indistinguishable from one that is broken, or
  // that the user just failed to find. When an explanation exists, show it.
  it('keeps an explained denial visible but inert, carrying the reason', () => {
    const [resolved] = resolveCommands([command({ decision: EXPLAINED })])
    expect(resolved.disabled).toBe(true)
    expect(resolved.unavailableReason).toBe(EXPLAINED.reason)
  })

  it('drops an explain denial that has no reason to give', () => {
    const decision = { allowed: false, presentation: 'explain' } as CapabilityDecision
    expect(resolveCommands([command({ decision })])).toEqual([])
  })
})

describe('runCommand', () => {
  // The palette is a second route to every action in the product, which is exactly where
  // a permission check gets forgotten. Denied commands must refuse at the point of
  // execution, not only in the render.
  it('refuses to execute a denied command', () => {
    const navigate = vi.fn()
    const run = vi.fn()
    expect(runCommand(command({ decision: EXPLAINED, run }), navigate)).toBe(false)
    expect(runCommand(command({ decision: HIDDEN, href: '/x' }), navigate)).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigates when the command carries an href', () => {
    const navigate = vi.fn()
    expect(runCommand(command({ decision: ALLOWED, href: '/dashboard?tab=calendar' }), navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/dashboard?tab=calendar')
  })

  it('invokes the side effect when there is no href', () => {
    const run = vi.fn()
    expect(runCommand(command({ decision: ALLOWED, run }), vi.fn())).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('prefers href over run when a command carries both', () => {
    const navigate = vi.fn()
    const run = vi.fn()
    runCommand(command({ href: '/a', run }), navigate)
    expect(navigate).toHaveBeenCalledWith('/a')
    expect(run).not.toHaveBeenCalled()
  })

  // Returning false lets the palette stay open on a no-op instead of dismissing itself
  // and looking like it did something.
  it('reports false when a command has nothing to do', () => {
    expect(runCommand(command(), vi.fn())).toBe(false)
  })
})

describe('groupCommands', () => {
  it('renders sections in the declared order and drops empty ones', () => {
    const groups = groupCommands([
      command({ id: 'a', group: 'create' }),
      command({ id: 'b', group: 'recent' }),
      command({ id: 'c', group: 'navigate' }),
    ])
    expect(groups.map((g) => g.id)).toEqual(['recent', 'navigate', 'create'])
  })

  it('never emits a section whose only command was hidden', () => {
    const groups = groupCommands([
      command({ id: 'a', group: 'navigate' }),
      command({ id: 'b', group: 'context', decision: HIDDEN }),
    ])
    expect(groups.map((g) => g.id)).toEqual(['navigate'])
  })

  it('labels every group it can emit', () => {
    const groups = groupCommands(
      COMMAND_GROUP_ORDER.map((group, i) => command({ id: `c${i}`, group })),
    )
    expect(groups).toHaveLength(COMMAND_GROUP_ORDER.length)
    for (const group of groups) expect(group.label).toBeTruthy()
  })
})

describe('buildNavigationCommands', () => {
  const groups: NavGroup[] = [
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard?tab=calendar', status: 'live' },
        { id: 'my-work', label: 'My Work', icon: 'inbox-check', href: '/my-work', status: 'planned' },
      ],
    },
  ]

  it('mirrors the host-filtered nav, so a disabled module cannot reappear as a shortcut', () => {
    const commands = buildNavigationCommands(groups)
    expect(commands.map((c) => c.href)).toEqual(['/dashboard?tab=calendar', '/my-work'])
    expect(commands.every((c) => c.group === 'navigate')).toBe(true)
  })

  it('marks not-yet-built destinations rather than pretending they are ready', () => {
    const [, planned] = buildNavigationCommands(groups)
    expect(planned.hint).toBe('Coming soon')
  })
})

describe('buildRecentCommands', () => {
  const records: RecentRecord[] = [
    { key: 'board:1', kind: 'board', label: 'Launch', href: '/dashboard/board/1', at: 2 },
    { key: 'task:9', kind: 'task', label: 'Fix login', href: '/dashboard/board/1?task=9', at: 1 },
  ]

  it('preserves order and labels each entry by kind', () => {
    const commands = buildRecentCommands(records)
    expect(commands.map((c) => c.label)).toEqual(['Launch', 'Fix login'])
    expect(commands.map((c) => c.hint)).toEqual(['Board', 'Task'])
  })

  it('caps the section so recents never crowd out search results', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...records[0], key: `board:${i}` }))
    expect(buildRecentCommands(many, 3)).toHaveLength(3)
  })
})

describe('buildFavoriteCommands', () => {
  const favorites = [
    { key: 'board:1', label: 'Atlas Rebuild', href: '/dashboard/board/1' },
    { key: 'board:2', label: 'SRG Listings', href: '/dashboard/board/2' },
  ]

  it('builds one command per favourite, in order', () => {
    const commands = buildFavoriteCommands(favorites)
    expect(commands.map((c) => c.label)).toEqual(['Atlas Rebuild', 'SRG Listings'])
    expect(commands.every((c) => c.group === 'favorite')).toBe(true)
  })

  it('matches on both spellings so neither audience has to guess', () => {
    const [first] = buildFavoriteCommands(favorites)
    expect(first.keywords).toContain('favourite')
    expect(first.keywords).toContain('favorite')
  })

  it('caps the section', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...favorites[0], key: `board:${i}` }))
    expect(buildFavoriteCommands(many, 4)).toHaveLength(4)
  })

  it('renders nothing when nothing is starred', () => {
    expect(buildFavoriteCommands([])).toEqual([])
  })

  // The palette is a search surface: a hit for a board the viewer cannot open would leak
  // its name. resolveFavorites is what drops those, so this asserts the contract that the
  // palette only ever receives already-resolved favourites.
  it('trusts its input to be resolved and does not filter again', () => {
    expect(buildFavoriteCommands(favorites).map((c) => c.href)).toEqual([
      '/dashboard/board/1',
      '/dashboard/board/2',
    ])
  })
})

describe('command group order', () => {
  it('puts what the user curated above what the app guessed', () => {
    expect(COMMAND_GROUP_ORDER.indexOf('favorite')).toBeLessThan(
      COMMAND_GROUP_ORDER.indexOf('recent'),
    )
  })

  it('groups favourites into their own labelled section', () => {
    const groups = groupCommands([
      ...buildFavoriteCommands([{ key: 'board:1', label: 'Atlas', href: '/b/1' }]),
      ...buildRecentCommands([
        { key: 'board:2', kind: 'board', label: 'Other', href: '/b/2', at: 1 },
      ]),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Favourites', 'Recent'])
  })
})

describe('buildCreateCommands', () => {
  const allOn = [
    { module_key: 'boards' as const, enabled: true },
    { module_key: 'personal_tasks' as const, enabled: true },
  ]

  /**
   * The regression that matters most here. app/dashboard/page.tsx redirects an admin to
   * /admin and DROPS the query string, so a Create command hardcoded to
   * '/dashboard?tab=boards' put every admin on whatever tab they last had open. Per
   * CLAUDE.md all five real users of this app hold admin or super_admin, so the palette's
   * Create section was broken for literally everyone who uses it.
   */
  for (const role of ['admin', 'super_admin'] as const) {
    it(`never hands a ${role} a /dashboard link`, () => {
      const hrefs = buildCreateCommands({ role, modules: allOn }).map((c) => c.href)
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) expect(href?.startsWith('/admin?tab=')).toBe(true)
    })
  }

  it('keeps a plain member on /dashboard, where their tabs actually live', () => {
    const hrefs = buildCreateCommands({ role: 'user', modules: allOn }).map((c) => c.href)
    for (const href of hrefs) expect(href?.startsWith('/dashboard?tab=')).toBe(true)
  })

  // A Create command for a module that is switched off is a link to a tab that is no
  // longer in the nav - the my-work copy of this list was not module-gated at all.
  it('drops a create action whose module is switched off', () => {
    const ids = buildCreateCommands({
      role: 'user',
      modules: [
        { module_key: 'boards', enabled: true },
        { module_key: 'personal_tasks', enabled: false },
      ],
    }).map((c) => c.id)
    expect(ids).toContain('create:board-task')
    expect(ids).not.toContain('create:personal-task')
  })

  it('puts everything it builds in the create group', () => {
    for (const command of buildCreateCommands({ role: 'admin', modules: allOn })) {
      expect(command.group).toBe('create')
    }
  })

  // Navigation, not mutation: these open the screen where the create affordance lives, so
  // a capability gate here would be a second, competing answer to a question the
  // destination already asks.
  it('carries no capability decision, because none of them write anything', () => {
    for (const command of buildCreateCommands({ role: 'user', modules: allOn })) {
      expect(command.decision).toBeUndefined()
    }
  })
})

describe('buildBoardContextCommands', () => {
  const noop = () => {}
  const options = {
    boardTitle: 'Roadmap',
    createDecision: ALLOWED,
    manageDecision: ALLOWED,
    membersDecision: ALLOWED,
    onCreate: noop,
    onFilter: noop,
    onOpenSettings: noop,
    onCopyLink: noop,
  }

  it('covers the plan\'s project-context list that exists today', () => {
    const ids = buildBoardContextCommands(options).map((c) => c.id)
    expect(ids).toContain('context:create-task')
    expect(ids).toContain('context:filter')
    expect(ids).toContain('context:members')
    expect(ids).toContain('context:settings')
  })

  // "Open saved view" is on the plan's list and saved views are Prompt E. A command that
  // opens nothing is worse than one that is not offered, so it is absent on purpose and
  // this test is what stops someone stubbing it in.
  it('offers no saved-view command while saved views do not exist', () => {
    const ids = buildBoardContextCommands(options).map((c) => c.id)
    expect(ids.some((id) => id.includes('saved') || id.includes('view'))).toBe(false)
  })

  it('puts everything in the context group', () => {
    for (const command of buildBoardContextCommands(options)) expect(command.group).toBe('context')
  })

  // The palette is a second route to every action, so its commands must carry the same
  // decisions the buttons do - resolveCommands is what then drops or disables them.
  it('drops the admin-only entries for someone with no path to them', () => {
    const resolved = resolveCommands(
      buildBoardContextCommands({ ...options, manageDecision: HIDDEN, membersDecision: HIDDEN }),
    ).map((c) => c.id)
    expect(resolved).not.toContain('context:settings')
    expect(resolved).not.toContain('context:members')
    expect(resolved).toContain('context:filter')
  })

  it('leaves a guest the create command visible but inert, with the reason', () => {
    const resolved = resolveCommands(
      buildBoardContextCommands({ ...options, createDecision: EXPLAINED }),
    )
    const create = resolved.find((c) => c.id === 'context:create-task')
    expect(create?.disabled).toBe(true)
    expect(create?.unavailableReason).toContain('Guest')
  })

  it('refuses to run the create command for a guest even if it is reached', () => {
    const command = buildBoardContextCommands({ ...options, createDecision: EXPLAINED })
      .find((c) => c.id === 'context:create-task')!
    const ran = vi.fn()
    expect(runCommand({ ...command, run: ran }, () => {})).toBe(false)
    expect(ran).not.toHaveBeenCalled()
  })
})

describe('buildWorkItemContextCommands', () => {
  const noop = () => {}
  const columns = [
    { id: 'col-todo', title: 'To Do' },
    { id: 'col-doing', title: 'In Progress' },
    { id: 'col-done', title: 'Done' },
  ]
  const options = {
    task: { id: 't1', title: 'Ship it', priority: 3, parentId: null as string | null },
    columns,
    currentColumnId: 'col-todo',
    editDecision: ALLOWED,
    onMoveToColumn: noop,
    onSetPriority: noop,
    onOpenAssignees: noop,
    onOpenLabels: noop,
    onCopyLink: noop,
    onOpenParent: noop,
    onOpenBoard: noop,
  }

  it('covers the plan\'s work-item-context list', () => {
    const ids = buildWorkItemContextCommands({ ...options, task: { ...options.task, parentId: 'p1' } })
      .map((c) => c.id)
    expect(ids.some((id) => id.startsWith('context:move:'))).toBe(true)      // change state
    expect(ids.some((id) => id.startsWith('context:priority:'))).toBe(true)  // change priority
    expect(ids).toContain('context:assign')                                  // assign
    expect(ids).toContain('context:labels')                                  // add/remove label
    expect(ids).toContain('context:copy-task-link')                          // copy link
    expect(ids).toContain('context:open-parent')                             // open parent
    expect(ids).toContain('context:open-board')                              // open project
  })

  // A command that moves the task where it already is, or sets the priority it already
  // has, is a no-op dressed as an action.
  it('omits the column the task is already in', () => {
    const ids = buildWorkItemContextCommands(options).map((c) => c.id)
    expect(ids).not.toContain('context:move:col-todo')
    expect(ids).toContain('context:move:col-doing')
  })

  it('omits the priority the task already has', () => {
    const ids = buildWorkItemContextCommands(options).map((c) => c.id)
    expect(ids).not.toContain('context:priority:3')
    expect(ids).toContain('context:priority:1')
    expect(ids.filter((id) => id.startsWith('context:priority:'))).toHaveLength(TASK_PRIORITIES.length - 1)
  })

  it('offers no open-parent command when there is no parent to open', () => {
    const ids = buildWorkItemContextCommands(options).map((c) => c.id)
    expect(ids).not.toContain('context:open-parent')
  })

  // The whole point of routing these through the capability layer: a guest reaching the
  // palette must not find an unguarded second route to every write on the card.
  it('makes every mutating command inert for a guest, and leaves the read-only ones alone', () => {
    const resolved = resolveCommands(
      buildWorkItemContextCommands({ ...options, editDecision: EXPLAINED }),
    )
    for (const command of resolved) {
      const mutating =
        command.id.startsWith('context:move:') ||
        command.id.startsWith('context:priority:') ||
        command.id === 'context:assign' ||
        command.id === 'context:labels'
      expect(command.disabled).toBe(mutating)
    }
    expect(resolved.find((c) => c.id === 'context:copy-task-link')?.disabled).toBe(false)
  })

  it('names the task it will act on, so a stale palette cannot mislead', () => {
    for (const command of buildWorkItemContextCommands(options)) {
      if (command.id.startsWith('context:move:') || command.id.startsWith('context:priority:')) {
        expect(command.hint).toBe('Ship it')
      }
    }
  })
})
