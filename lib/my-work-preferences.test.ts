import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  MY_WORK_SECTIONS,
  MY_WORK_SECTION_IDS,
  applyPreferences,
  isSectionVisible,
  moveSection,
  myWorkPreferencesKey,
  parseMyWorkPreferences,
  resetMyWorkPreferences,
  serializeMyWorkPreferences,
  toggleSection,
} from './my-work-preferences'

describe('the section catalog', () => {
  it('has a label for every id and no duplicates', () => {
    expect(new Set(MY_WORK_SECTION_IDS).size).toBe(MY_WORK_SECTION_IDS.length)
    for (const section of MY_WORK_SECTIONS) expect(section.label.length).toBeGreaterThan(0)
  })

  it('keys storage per user, so two people on one browser do not share a layout', () => {
    expect(myWorkPreferencesKey('a')).not.toBe(myWorkPreferencesKey('b'))
  })
})

describe('parseMyWorkPreferences', () => {
  it('gives a new person the default order and nothing hidden', () => {
    expect(parseMyWorkPreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parseMyWorkPreferences('')).toEqual(DEFAULT_PREFERENCES)
  })

  it('survives corrupt JSON rather than blanking the page', () => {
    expect(parseMyWorkPreferences('{oh no')).toEqual(DEFAULT_PREFERENCES)
    expect(parseMyWorkPreferences('"a string"')).toEqual(DEFAULT_PREFERENCES)
  })

  it('keeps a stored order', () => {
    const stored = serializeMyWorkPreferences({ order: ['assigned', ...MY_WORK_SECTION_IDS.filter((id) => id !== 'assigned')], hidden: ['personal'] })
    const parsed = parseMyWorkPreferences(stored)
    expect(parsed.order[0]).toBe('assigned')
    expect(parsed.hidden).toEqual(['personal'])
  })

  it('drops a section that no longer exists', () => {
    const parsed = parseMyWorkPreferences(JSON.stringify({ order: ['gone-away', 'overdue'], hidden: ['also-gone'] }))
    expect(parsed.order).not.toContain('gone-away')
    expect(parsed.hidden).toEqual([])
  })

  it('adds a section the stored order has never heard of, in its default position', () => {
    // The failure this prevents: shipping a new section that is invisible to everyone who
    // ever opened the customize panel, with nothing on screen to explain it.
    const withoutBlocking = MY_WORK_SECTION_IDS.filter((id) => id !== 'blocking')
    const parsed = parseMyWorkPreferences(JSON.stringify({ order: withoutBlocking, hidden: [] }))
    expect(parsed.order).toEqual([...MY_WORK_SECTION_IDS])
    expect(parsed.order.length).toBe(MY_WORK_SECTION_IDS.length)
  })

  it('always returns exactly the known ids, once each', () => {
    const parsed = parseMyWorkPreferences(JSON.stringify({ order: ['overdue', 'overdue', 'nope', 7], hidden: [1, 'today'] }))
    expect([...parsed.order].sort()).toEqual([...MY_WORK_SECTION_IDS].sort())
    expect(parsed.hidden).toEqual(['today'])
  })
})

describe('toggleSection', () => {
  it('hides and unhides', () => {
    const hidden = toggleSection(DEFAULT_PREFERENCES, 'personal')
    expect(isSectionVisible(hidden, 'personal')).toBe(false)
    expect(isSectionVisible(toggleSection(hidden, 'personal'), 'personal')).toBe(true)
  })

  it('ignores a section it does not know', () => {
    expect(toggleSection(DEFAULT_PREFERENCES, 'invented')).toBe(DEFAULT_PREFERENCES)
  })

  it('never mutates its input', () => {
    const before = { order: [...MY_WORK_SECTION_IDS], hidden: [] as string[] }
    toggleSection(before, 'today')
    expect(before.hidden).toEqual([])
  })
})

describe('moveSection', () => {
  it('moves up and down', () => {
    const moved = moveSection(DEFAULT_PREFERENCES, 'today', -1)
    expect(moved.order.indexOf('today')).toBe(DEFAULT_PREFERENCES.order.indexOf('today') - 1)
    expect(moveSection(DEFAULT_PREFERENCES, 'today', 1).order.indexOf('today'))
      .toBe(DEFAULT_PREFERENCES.order.indexOf('today') + 1)
  })

  it('stops at both ends rather than wrapping around', () => {
    const first = DEFAULT_PREFERENCES.order[0]
    const last = DEFAULT_PREFERENCES.order[DEFAULT_PREFERENCES.order.length - 1]
    expect(moveSection(DEFAULT_PREFERENCES, first, -1).order).toEqual(DEFAULT_PREFERENCES.order)
    expect(moveSection(DEFAULT_PREFERENCES, last, 1).order).toEqual(DEFAULT_PREFERENCES.order)
  })

  it('keeps every section, whatever it does', () => {
    let prefs = DEFAULT_PREFERENCES
    for (let i = 0; i < 20; i++) prefs = moveSection(prefs, MY_WORK_SECTION_IDS[i % MY_WORK_SECTION_IDS.length], i % 2 ? 1 : -1)
    expect([...prefs.order].sort()).toEqual([...MY_WORK_SECTION_IDS].sort())
  })

  it('ignores a section it does not know', () => {
    expect(moveSection(DEFAULT_PREFERENCES, 'invented', 1)).toBe(DEFAULT_PREFERENCES)
  })
})

describe('applyPreferences', () => {
  const sections = [
    { id: 'assigned' }, { id: 'overdue' }, { id: 'personal' }, { id: 'recommended-next' },
  ]

  it('orders by the stored preference, not by the order they were built in', () => {
    expect(applyPreferences(sections, DEFAULT_PREFERENCES).map((s) => s.id))
      .toEqual(['recommended-next', 'overdue', 'personal', 'assigned'])
  })

  it('drops hidden sections', () => {
    const prefs = toggleSection(DEFAULT_PREFERENCES, 'personal')
    expect(applyPreferences(sections, prefs).map((s) => s.id)).not.toContain('personal')
  })

  it('never mutates the sections it was given', () => {
    const input = [...sections]
    applyPreferences(input, DEFAULT_PREFERENCES)
    expect(input.map((s) => s.id)).toEqual(sections.map((s) => s.id))
  })

  it('puts a section it has no rank for at the end rather than dropping it', () => {
    const withStranger = [...sections, { id: 'not-in-the-catalog' }]
    const out = applyPreferences(withStranger, DEFAULT_PREFERENCES)
    expect(out[out.length - 1].id).toBe('not-in-the-catalog')
  })
})

describe('resetMyWorkPreferences', () => {
  it('restores the default order and shows everything', () => {
    expect(resetMyWorkPreferences()).toEqual(DEFAULT_PREFERENCES)
  })
})
