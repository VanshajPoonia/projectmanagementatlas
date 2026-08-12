import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DENSITY,
  DENSITIES,
  DENSITY_HINTS,
  DENSITY_LABELS,
  densityCardClass,
  densityListClass,
  densityStorageKey,
  parseDensity,
  showsDescriptionPreview,
  showsSecondaryDetail,
} from './density'

describe('parseDensity', () => {
  it('accepts every supported level', () => {
    for (const d of DENSITIES) expect(parseDensity(d)).toBe(d)
  })

  // Density is read straight out of localStorage, which anyone can edit. An unknown
  // value must land on the default rather than producing a card with no padding class.
  it('falls back to the default for missing or unknown values', () => {
    expect(parseDensity(null)).toBe(DEFAULT_DENSITY)
    expect(parseDensity('')).toBe(DEFAULT_DENSITY)
    expect(parseDensity('ultra')).toBe(DEFAULT_DENSITY)
  })

  it('defaults to comfortable', () => {
    expect(DEFAULT_DENSITY).toBe('comfortable')
  })
})

describe('density classes', () => {
  it('gives every level a distinct card and list rhythm', () => {
    const cards = new Set(DENSITIES.map(densityCardClass))
    const lists = new Set(DENSITIES.map(densityListClass))
    expect(cards.size).toBe(DENSITIES.length)
    expect(lists.size).toBe(DENSITIES.length)
  })

  it('orders padding from compact through expanded', () => {
    expect(densityCardClass('compact')).toContain('p-2')
    expect(densityCardClass('comfortable')).toContain('p-3')
    expect(densityCardClass('expanded')).toContain('p-4')
  })
})

describe('detail thresholds', () => {
  // Compact exists to fit more work on screen; if it still rendered every chip and a
  // description preview it would not be compact.
  it('hides secondary detail only in compact', () => {
    expect(showsSecondaryDetail('compact')).toBe(false)
    expect(showsSecondaryDetail('comfortable')).toBe(true)
    expect(showsSecondaryDetail('expanded')).toBe(true)
  })

  it('shows a description preview only in expanded', () => {
    expect(showsDescriptionPreview('expanded')).toBe(true)
    expect(showsDescriptionPreview('comfortable')).toBe(false)
    expect(showsDescriptionPreview('compact')).toBe(false)
  })
})

describe('presentation metadata', () => {
  it('labels and hints every level, so the switcher can never render a blank option', () => {
    for (const d of DENSITIES) {
      expect(DENSITY_LABELS[d]).toBeTruthy()
      expect(DENSITY_HINTS[d]).toBeTruthy()
    }
  })
})

describe('densityStorageKey', () => {
  it('is per-user, so one person’s choice never changes another’s board', () => {
    expect(densityStorageKey('a')).not.toBe(densityStorageKey('b'))
  })
})
