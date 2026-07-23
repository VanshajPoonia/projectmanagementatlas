import { describe, it, expect } from 'vitest'
import { resolveActiveTab } from './tab-url'

const allowed = ['tasks', 'personal', 'calendar', 'boards', 'chat'] as const

describe('resolveActiveTab', () => {
  it('prefers a valid URL tab above everything', () => {
    expect(resolveActiveTab('calendar', 'chat', allowed, 'tasks')).toBe('calendar')
  })

  it('falls back to a valid saved tab when the URL has none', () => {
    expect(resolveActiveTab(null, 'chat', allowed, 'tasks')).toBe('chat')
  })

  it('falls back to the default when neither is valid', () => {
    expect(resolveActiveTab(null, null, allowed, 'tasks')).toBe('tasks')
  })

  it('ignores an invalid URL tab and uses the saved one', () => {
    expect(resolveActiveTab('bogus', 'boards', allowed, 'tasks')).toBe('boards')
  })

  it('ignores an invalid saved tab and uses the default', () => {
    expect(resolveActiveTab(null, 'nope', allowed, 'tasks')).toBe('tasks')
  })

  it('ignores an invalid URL tab AND invalid saved tab', () => {
    expect(resolveActiveTab('x', 'y', allowed, 'tasks')).toBe('tasks')
  })

  it('does not treat an empty string as valid', () => {
    expect(resolveActiveTab('', '', allowed, 'tasks')).toBe('tasks')
  })
})
