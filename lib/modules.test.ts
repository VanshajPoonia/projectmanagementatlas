import { describe, it, expect } from 'vitest'
import { isModuleEnabled, DEFAULT_MODULES, type AppModule } from './modules'

describe('isModuleEnabled', () => {
  it('returns true for every module in the default set', () => {
    for (const m of DEFAULT_MODULES) {
      expect(isModuleEnabled(DEFAULT_MODULES, m.module_key)).toBe(true)
    }
  })

  it('respects an explicit disabled row', () => {
    const modules: AppModule[] = [{ module_key: 'reports', enabled: false }]
    expect(isModuleEnabled(modules, 'reports')).toBe(false)
  })

  it('defaults to enabled when a key has no row yet', () => {
    expect(isModuleEnabled([], 'ai_assistant')).toBe(true)
  })
})
