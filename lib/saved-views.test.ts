import { describe, it, expect, vi } from 'vitest'
import {
  mapSavedView,
  groupViews,
  viewsForBoard,
  canManageView,
  manageBlockedReason,
  duplicateNameWarning,
  validateViewName,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  loadSavedViews,
  type SavedView,
} from './saved-views'
import { DEFAULT_VIEW_CONFIG } from './view-config'

const view = (over: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  name: 'This week',
  description: null,
  scope: 'personal',
  ownerId: 'u-ann',
  boardId: null,
  config: DEFAULT_VIEW_CONFIG,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
})

describe('mapping a row', () => {
  it('normalizes a config that arrived malformed instead of throwing', () => {
    const mapped = mapSavedView({
      id: 'v', name: 'X', scope: 'personal', owner_id: 'u', board_id: null,
      config: { layout: 'gantt' }, created_at: 'a', updated_at: 'b',
    })
    expect(mapped.config.layout).toBe('kanban')
  })

  it('treats any unknown scope as personal, the narrower of the two', () => {
    const mapped = mapSavedView({
      id: 'v', name: 'X', scope: 'public', owner_id: 'u', board_id: null,
      config: {}, created_at: 'a', updated_at: 'b',
    })
    expect(mapped.scope).toBe('personal')
  })

  it('turns a missing description into null rather than undefined', () => {
    expect(mapSavedView({ id: 'v', name: 'X', scope: 'personal', owner_id: 'u', config: {}, created_at: 'a', updated_at: 'b' }).description).toBeNull()
  })
})

describe('grouping for a picker', () => {
  const views = [
    view({ id: 'a', name: 'Zulu', scope: 'personal', ownerId: 'u-ann' }),
    view({ id: 'b', name: 'Alpha', scope: 'personal', ownerId: 'u-ann' }),
    view({ id: 'c', name: 'Team board', scope: 'shared', ownerId: 'u-bob' }),
    view({ id: 'd', name: 'Someone else', scope: 'personal', ownerId: 'u-bob' }),
  ]

  it('shows only my own personal views', () => {
    expect(groupViews(views, 'u-ann').personal.map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('shows shared views whoever made them', () => {
    expect(groupViews(views, 'u-ann').shared.map((v) => v.id)).toEqual(['c'])
  })

  it('sorts each group by name', () => {
    expect(groupViews(views, 'u-ann').personal.map((v) => v.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('signed out sees no personal views at all', () => {
    expect(groupViews(views, null).personal).toEqual([])
  })
})

describe('which views apply to a board', () => {
  const views = [
    view({ id: 'global', boardId: null }),
    view({ id: 'here', boardId: 'b-1' }),
    view({ id: 'elsewhere', boardId: 'b-2' }),
  ]

  it('offers this board\'s views and every cross-board one', () => {
    expect(viewsForBoard(views, 'b-1').map((v) => v.id)).toEqual(['global', 'here'])
  })

  it('offers only cross-board views when there is no board', () => {
    expect(viewsForBoard(views, null).map((v) => v.id)).toEqual(['global'])
  })
})

describe('who may manage a view', () => {
  it('the owner always may', () => {
    expect(canManageView(view({ ownerId: 'u-ann' }), 'u-ann', false)).toBe(true)
  })

  // A personal view is private, including from admins - 119 asserts the SELECT policy has no
  // admin term. The client must not offer an ability the database refuses.
  it('an admin may not touch someone else\'s PERSONAL view', () => {
    expect(canManageView(view({ ownerId: 'u-bob', scope: 'personal' }), 'u-ann', true)).toBe(false)
  })

  it('an admin may manage a shared view they did not create', () => {
    expect(canManageView(view({ ownerId: 'u-bob', scope: 'shared' }), 'u-ann', true)).toBe(true)
  })

  it('a non-admin may not manage someone else\'s shared view', () => {
    expect(canManageView(view({ ownerId: 'u-bob', scope: 'shared' }), 'u-ann', false)).toBe(false)
  })

  it('signed out may manage nothing', () => {
    expect(canManageView(view(), null, false)).toBe(false)
  })

  it('explains why rather than silently disabling', () => {
    expect(manageBlockedReason(view({ ownerId: 'u-bob', scope: 'shared' }), 'u-ann', false)).toMatch(/admin/)
    expect(manageBlockedReason(view({ ownerId: 'u-bob' }), 'u-ann', true)).toMatch(/personal/)
    expect(manageBlockedReason(view({ ownerId: 'u-ann' }), 'u-ann', false)).toBeNull()
  })
})

describe('names', () => {
  it('refuses a blank name', () => {
    expect(validateViewName('   ')).toBeTruthy()
    expect(validateViewName('Fine')).toBeNull()
  })

  it('refuses a name past the column limit rather than letting the insert fail', () => {
    expect(validateViewName('x'.repeat(121))).toBeTruthy()
    expect(validateViewName('x'.repeat(120))).toBeNull()
  })

  // 119 has no UNIQUE constraint on purpose, so the warning lives in the client.
  it('warns about a clash in the same scope on the same board', () => {
    const views = [view({ id: 'a', name: 'This week', scope: 'personal', boardId: 'b-1' })]
    expect(duplicateNameWarning(views, 'This week', 'personal', 'b-1')).toBeTruthy()
    expect(duplicateNameWarning(views, 'this WEEK', 'personal', 'b-1')).toBeTruthy()
  })

  it('does not warn across scopes or boards, where the same name is reasonable', () => {
    const views = [view({ id: 'a', name: 'This week', scope: 'personal', boardId: 'b-1' })]
    expect(duplicateNameWarning(views, 'This week', 'shared', 'b-1')).toBeNull()
    expect(duplicateNameWarning(views, 'This week', 'personal', 'b-2')).toBeNull()
  })

  it('does not warn about the view being renamed itself', () => {
    const views = [view({ id: 'a', name: 'This week' })]
    expect(duplicateNameWarning(views, 'This week', 'personal', null, 'a')).toBeNull()
  })
})

/* ── Writes: an RLS refusal returns zero rows and no error ─────────────────────────── */

const row = { id: 'v1', name: 'X', description: null, scope: 'personal', owner_id: 'u-ann', board_id: null, config: { layout: 'list' }, created_at: 'a', updated_at: 'b' }

function fakeInsert(result: { data: unknown[] | null; error: { message: string } | null }) {
  const select = vi.fn().mockResolvedValue(result)
  const insert = vi.fn().mockReturnValue({ select })
  return { supabase: { from: vi.fn().mockReturnValue({ insert }) }, insert, select }
}

describe('creating a view', () => {
  it('returns the row it got back', async () => {
    const { supabase } = fakeInsert({ data: [row], error: null })
    const out = await createSavedView(supabase as any, 'u-ann', {
      name: '  Spaced  ', scope: 'personal', boardId: null, config: DEFAULT_VIEW_CONFIG,
    })
    expect(out.outcome.kind).toBe('ok')
    expect(out.view?.id).toBe('v1')
    expect(out.message).toBeNull()
  })

  it('trims the name before it reaches the database', async () => {
    const { supabase, insert } = fakeInsert({ data: [row], error: null })
    await createSavedView(supabase as any, 'u-ann', {
      name: '  Spaced  ', scope: 'personal', boardId: null, config: DEFAULT_VIEW_CONFIG,
    })
    expect(insert.mock.calls[0][0].name).toBe('Spaced')
  })

  it('turns a whitespace-only description into null, not an empty string', async () => {
    const { supabase, insert } = fakeInsert({ data: [row], error: null })
    await createSavedView(supabase as any, 'u-ann', {
      name: 'X', description: '   ', scope: 'personal', boardId: null, config: DEFAULT_VIEW_CONFIG,
    })
    expect(insert.mock.calls[0][0].description).toBeNull()
  })

  it('never stores the search box', async () => {
    const { supabase, insert } = fakeInsert({ data: [row], error: null })
    await createSavedView(supabase as any, 'u-ann', {
      name: 'X', scope: 'personal', boardId: null,
      config: { ...DEFAULT_VIEW_CONFIG, search: 'riverside' },
    })
    expect(insert.mock.calls[0][0].config).not.toHaveProperty('search')
  })

  // The failure this whole convention exists for: zero rows, no error.
  it('reports a zero-row insert as a refusal, not a success', async () => {
    const { supabase } = fakeInsert({ data: [], error: null })
    const out = await createSavedView(supabase as any, 'u-ann', {
      name: 'X', scope: 'personal', boardId: null, config: DEFAULT_VIEW_CONFIG,
    })
    expect(out.outcome.kind).toBe('refused')
    expect(out.view).toBeNull()
    expect(out.message).toBeTruthy()
  })

  it('surfaces a real database error with its message', async () => {
    const { supabase } = fakeInsert({ data: null, error: { message: 'boom' } })
    const out = await createSavedView(supabase as any, 'u-ann', {
      name: 'X', scope: 'personal', boardId: null, config: DEFAULT_VIEW_CONFIG,
    })
    expect(out.outcome.kind).toBe('error')
    expect(out.message?.description).toContain('boom')
  })
})

describe('updating a view', () => {
  function fakeUpdate(result: { data: unknown[] | null; error: { message: string } | null }) {
    const select = vi.fn().mockResolvedValue(result)
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    return { supabase: { from: vi.fn().mockReturnValue({ update }) }, update }
  }

  it('sends only the keys it was given', async () => {
    const { supabase, update } = fakeUpdate({ data: [row], error: null })
    await updateSavedView(supabase as any, 'v1', { name: 'Renamed' })
    expect(Object.keys(update.mock.calls[0][0])).toEqual(['name'])
  })

  it('can clear a description explicitly', async () => {
    const { supabase, update } = fakeUpdate({ data: [row], error: null })
    await updateSavedView(supabase as any, 'v1', { description: null })
    expect(update.mock.calls[0][0]).toEqual({ description: null })
  })

  it('reports a zero-row update as a refusal', async () => {
    const { supabase } = fakeUpdate({ data: [], error: null })
    expect((await updateSavedView(supabase as any, 'v1', { name: 'X' })).outcome.kind).toBe('refused')
  })
})

describe('deleting a view', () => {
  function fakeDelete(result: { data: unknown[] | null; error: { message: string } | null }) {
    const select = vi.fn().mockResolvedValue(result)
    const eq = vi.fn().mockReturnValue({ select })
    const del = vi.fn().mockReturnValue({ eq })
    return { supabase: { from: vi.fn().mockReturnValue({ delete: del }) } }
  }

  it('is ok when a row came back', async () => {
    expect((await deleteSavedView(fakeDelete({ data: [{ id: 'v1' }], error: null }).supabase as any, 'v1')).outcome.kind).toBe('ok')
  })

  // PostgREST does not treat a zero-row DELETE as an error - the board_members lesson.
  it('reports a zero-row delete as a refusal rather than success', async () => {
    const out = await deleteSavedView(fakeDelete({ data: [], error: null }).supabase as any, 'v1')
    expect(out.outcome.kind).toBe('refused')
    expect(out.message).toBeTruthy()
  })
})

describe('loading views', () => {
  it('maps every row', async () => {
    const order = vi.fn().mockResolvedValue({ data: [row], error: null })
    const select = vi.fn().mockReturnValue({ order })
    const supabase = { from: vi.fn().mockReturnValue({ select }) }
    const out = await loadSavedViews(supabase as any)
    expect(out.views).toHaveLength(1)
    expect(out.error).toBeNull()
  })

  it('returns an empty list and the message on error, never throws', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } })
    const select = vi.fn().mockReturnValue({ order })
    const supabase = { from: vi.fn().mockReturnValue({ select }) }
    const out = await loadSavedViews(supabase as any)
    expect(out.views).toEqual([])
    expect(out.error).toBe('nope')
  })
})
