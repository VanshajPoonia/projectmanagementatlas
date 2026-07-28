import { describe, expect, it } from 'vitest'
import {
  centeredScrollLeft,
  isImportedWeekendPlaceholder,
  reconcileCompanySelection,
  toggleCompanySelection,
} from './marketing-calendar-state'

const allCompanies = ['srg', 'agc']

describe('marketing calendar company filter', () => {
  it('isolates a company when it is clicked from All', () => {
    expect(toggleCompanySelection([], 'agc')).toEqual(['agc'])
    expect(toggleCompanySelection([], 'srg')).toEqual(['srg'])
  })

  it('returns to All when the last selected company is turned off', () => {
    expect(toggleCompanySelection(['agc'], 'agc')).toEqual([])
  })

  it('switches directly between companies instead of falling back to All', () => {
    expect(toggleCompanySelection(['srg'], 'agc')).toEqual(['agc'])
    expect(toggleCompanySelection(['agc'], 'srg')).toEqual(['srg'])
  })

  it('preserves valid filters and removes archived company ids on refresh', () => {
    expect(reconcileCompanySelection(['agc', 'archived'], allCompanies)).toEqual(['agc'])
    expect(reconcileCompanySelection(['archived'], allCompanies)).toEqual([])
  })

  it('keeps the most recently selected company from legacy multi-select state', () => {
    expect(reconcileCompanySelection(['srg', 'agc'], allCompanies)).toEqual(['agc'])
  })
})

describe('marketing calendar Today navigation', () => {
  it('centers today using scroll-container-relative geometry', () => {
    expect(centeredScrollLeft({
      currentScrollLeft: 640,
      containerLeft: 80,
      containerWidth: 360,
      targetLeft: 410,
      targetWidth: 150,
    })).toBe(865)
  })

  it('never scrolls before the start of the week board', () => {
    expect(centeredScrollLeft({
      currentScrollLeft: 0,
      containerLeft: 80,
      containerWidth: 900,
      targetLeft: 120,
      targetWidth: 150,
    })).toBe(0)
  })
})

describe('imported weekend placeholders', () => {
  it('recognizes exact imported Sat/Sun wk filler rows', () => {
    expect(isImportedWeekendPlaceholder({
      source_sheet: '2026 Calendar',
      day_label: 'SAT',
      content: ' wk ',
    })).toBe(true)
  })

  it('keeps real weekend posts and user-created events', () => {
    expect(isImportedWeekendPlaceholder({
      source_sheet: '2026 Calendar',
      day_label: 'SAT',
      content: 'Happy 4th',
    })).toBe(false)
    expect(isImportedWeekendPlaceholder({
      source_sheet: null,
      day_label: 'SUN',
      content: 'wk',
    })).toBe(false)
  })
})
