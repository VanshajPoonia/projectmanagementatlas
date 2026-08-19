import { describe, it, expect } from 'vitest'
import { isModuleEnabled, DEFAULT_MODULES, type AppModule } from './modules'
// Server-only, so it lives in the registry rather than the React-bearing module.
import { isModuleEnabledOnServer } from './module-registry'

describe('isModuleEnabled', () => {
  it('reports each default module according to its own flag', () => {
    for (const m of DEFAULT_MODULES) {
      expect(isModuleEnabled(DEFAULT_MODULES, m.module_key)).toBe(m.enabled)
    }
  })

  // 'appointments' (migration 080) and 'crm' (migration 103) are the deliberate exceptions to
  // the every-module-available fallback: both are seeded disabled, and the fallback must not
  // reveal a module nobody has switched on. Pinning the exact set means adding a third
  // off-by-default module, or flipping an existing one, fails here and has to be a conscious
  // decision rather than a silent regression.
  it('defaults exactly appointments and crm to off', () => {
    const disabled = DEFAULT_MODULES.filter(m => !m.enabled).map(m => m.module_key)
    expect(disabled.sort()).toEqual(['appointments', 'crm'])
  })

  // The other half of the same guarantee: every remaining module stays available, so a
  // failure to load app_modules never silently hides working features.
  it('leaves every other module available in the fallback', () => {
    const enabled = DEFAULT_MODULES.filter(m => m.enabled).map(m => m.module_key)
    expect(enabled).toContain('boards')
    expect(enabled).toContain('marketing_calendar')
    expect(enabled).not.toContain('crm')
  })

  it('respects an explicit disabled row', () => {
    const modules: AppModule[] = [{ module_key: 'reports', enabled: false }]
    expect(isModuleEnabled(modules, 'reports')).toBe(false)
  })

  it('defaults to enabled when a key has no row yet', () => {
    expect(isModuleEnabled([], 'ai_assistant')).toBe(true)
  })
})

describe('isModuleEnabledOnServer', () => {
  // The AI assistant was gated at three render sites and nowhere else, so switching it off
  // hid the widget while POST /api/ai-chat kept answering. A module toggle that only hides
  // a button is not a toggle - this is the server half.
  const client = (row: { module_key: string; enabled: boolean } | null, error?: unknown) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: error ?? null }) }),
      }),
    }),
  })

  it('reports the stored value when the row exists', async () => {
    expect(await isModuleEnabledOnServer(client({ module_key: 'ai_assistant', enabled: true }), 'ai_assistant')).toBe(true)
    expect(await isModuleEnabledOnServer(client({ module_key: 'ai_assistant', enabled: false }), 'ai_assistant')).toBe(false)
  })

  // Follows lib/modules.ts's rule, not requireCrmAccess's stricter one: an unreadable
  // app_modules must never silently disable working features for everyone at once.
  it('falls back to available for a module that defaults on', async () => {
    expect(await isModuleEnabledOnServer(client(null), 'ai_assistant')).toBe(true)
    expect(await isModuleEnabledOnServer(client(null), 'boards')).toBe(true)
  })

  // ...but the two modules seeded disabled must stay refused on that same path, or a failed
  // read would reveal a module a super admin has never switched on.
  it('keeps the fail-closed modules closed when the row is missing', async () => {
    expect(await isModuleEnabledOnServer(client(null), 'crm')).toBe(false)
    expect(await isModuleEnabledOnServer(client(null), 'appointments')).toBe(false)
  })
})
