import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SIDEBAR_STATE,
  sidebarStorageKey,
  parseSidebarState,
  serializeSidebarState,
  toggleSidebarMode,
  isCollapsed,
} from './sidebar-state'

describe('sidebar-state', () => {
  it('namespaces the storage key per user', () => {
    expect(sidebarStorageKey('user-1')).toBe('app_sidebar_state:user-1')
    expect(sidebarStorageKey('user-2')).not.toBe(sidebarStorageKey('user-1'))
  })

  it('defaults to expanded when nothing is stored', () => {
    expect(parseSidebarState(null)).toEqual(DEFAULT_SIDEBAR_STATE)
    expect(parseSidebarState(null).mode).toBe('expanded')
  })

  it('falls back to default on malformed JSON', () => {
    expect(parseSidebarState('{not json')).toEqual(DEFAULT_SIDEBAR_STATE)
  })

  it('coerces unknown modes to expanded', () => {
    expect(parseSidebarState('{"mode":"weird"}').mode).toBe('expanded')
  })

  it('round-trips through serialize/parse', () => {
    const state = { mode: 'collapsed' as const }
    expect(parseSidebarState(serializeSidebarState(state))).toEqual(state)
  })

  it('toggles between expanded and collapsed', () => {
    expect(toggleSidebarMode({ mode: 'expanded' }).mode).toBe('collapsed')
    expect(toggleSidebarMode({ mode: 'collapsed' }).mode).toBe('expanded')
  })

  it('reports collapsed correctly', () => {
    expect(isCollapsed({ mode: 'collapsed' })).toBe(true)
    expect(isCollapsed({ mode: 'expanded' })).toBe(false)
  })
})
