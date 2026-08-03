import { describe, it, expect } from 'vitest'
import { isModuleEnabled, DEFAULT_MODULES, type AppModule } from './modules'

describe('isModuleEnabled', () => {
  it('reports each default module according to its own flag', () => {
    for (const m of DEFAULT_MODULES) {
      expect(isModuleEnabled(DEFAULT_MODULES, m.module_key)).toBe(m.enabled)
    }
  })

  // 'appointments' is the single deliberate exception to the every-module-available
  // fallback (migration 080 seeds it disabled, and the fallback must not reveal a
  // module nobody switched on). Pinning the exact set means adding a second
  // off-by-default module, or flipping an existing one, fails here and has to be a
  // conscious decision rather than a silent regression.
  it('defaults only the appointments module to off', () => {
    const disabled = DEFAULT_MODULES.filter(m => !m.enabled).map(m => m.module_key)
    expect(disabled).toEqual(['appointments'])
  })

  it('respects an explicit disabled row', () => {
    const modules: AppModule[] = [{ module_key: 'reports', enabled: false }]
    expect(isModuleEnabled(modules, 'reports')).toBe(false)
  })

  it('defaults to enabled when a key has no row yet', () => {
    expect(isModuleEnabled([], 'ai_assistant')).toBe(true)
  })
})
