import { describe, it, expect, vi } from 'vitest'
import {
  COMMAND_GROUP_ORDER,
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
