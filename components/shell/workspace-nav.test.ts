import { describe, it, expect } from 'vitest'
import { addressableTabs, buildWorkspaceNav } from './workspace-nav'
import { DEFAULT_MODULES, type AppModule } from '@/lib/modules'

function ids(groups: ReturnType<typeof buildWorkspaceNav>, groupId = 'sections') {
  return groups.find((g) => g.id === groupId)?.items.map((i) => i.id) ?? []
}

const base = { role: 'user' as const, modules: DEFAULT_MODULES, canUseMarketingCalendar: true }

describe('buildWorkspaceNav', () => {
  it('always offers Home and My Work, whatever the module configuration', () => {
    const off: AppModule[] = DEFAULT_MODULES.map((m) => ({ ...m, enabled: false }))
    expect(ids(buildWorkspaceNav({ ...base, modules: off, canUseMarketingCalendar: false }))).toEqual([
      'tasks',
      'my-work',
    ])
  })

  it('lists My Work as a real destination, not a placeholder', () => {
    const item = buildWorkspaceNav(base)[0].items.find((i) => i.id === 'my-work')
    expect(item?.status).toBe('live')
    expect(item?.href).toBe('/my-work')
  })

  it('drops a section whose module is switched off', () => {
    const modules = DEFAULT_MODULES.map((m) => (m.module_key === 'chat' ? { ...m, enabled: false } : m))
    expect(ids(buildWorkspaceNav({ ...base, modules }))).not.toContain('chat')
    expect(ids(buildWorkspaceNav(base))).toContain('chat')
  })

  // Appointments seeds disabled (migration 080) and must stay hidden until a super_admin
  // switches it on — the nav is not allowed to reveal a module nobody enabled.
  it('honours the appointments module defaulting to off', () => {
    expect(ids(buildWorkspaceNav(base))).not.toContain('appointments')
    const on = DEFAULT_MODULES.map((m) =>
      m.module_key === 'appointments' ? { ...m, enabled: true } : m,
    )
    expect(ids(buildWorkspaceNav({ ...base, modules: on }))).toContain('appointments')
  })

  // Marketing needs BOTH the module and the per-user access check (migration 085): being
  // a calendar member must not resurrect a module the org has turned off, and the module
  // being on must not hand the section to someone with no calendar.
  it('requires the marketing module and calendar access together', () => {
    expect(ids(buildWorkspaceNav({ ...base, canUseMarketingCalendar: false }))).not.toContain('marketing')

    const moduleOff = DEFAULT_MODULES.map((m) =>
      m.module_key === 'marketing_calendar' ? { ...m, enabled: false } : m,
    )
    expect(ids(buildWorkspaceNav({ ...base, modules: moduleOff }))).not.toContain('marketing')
    expect(ids(buildWorkspaceNav(base))).toContain('marketing')
  })
})

describe('admin group', () => {
  it('is absent for a plain user', () => {
    expect(buildWorkspaceNav(base).map((g) => g.id)).toEqual(['sections'])
  })

  it('gives admins the admin entry but not the super-admin one', () => {
    expect(ids(buildWorkspaceNav({ ...base, role: 'admin' }), 'admin')).toEqual(['admin-home'])
  })

  it('gives super admins both', () => {
    expect(ids(buildWorkspaceNav({ ...base, role: 'super_admin' }), 'admin')).toEqual([
      'admin-home',
      'super-admin',
    ])
  })
})

describe('addressableTabs', () => {
  // ?tab= may only address sections the dashboard actually hosts. My Work is a route of
  // its own, so listing it as a tab would resolve to a screen that doesn't exist there.
  it('returns only dashboard-hosted sections', () => {
    const tabs = addressableTabs(buildWorkspaceNav(base))
    expect(tabs).toContain('calendar')
    expect(tabs).not.toContain('my-work')
    expect(tabs).not.toContain('admin-home')
  })

  it('shrinks with the nav when modules are switched off', () => {
    const modules = DEFAULT_MODULES.map((m) =>
      m.module_key === 'boards' ? { ...m, enabled: false } : m,
    )
    expect(addressableTabs(buildWorkspaceNav({ ...base, modules }))).not.toContain('boards')
  })
})
