import { describe, expect, it } from 'vitest'
import {
  isImportedWeekendPlaceholder,
  reconcileCompanySelection,
  toggleCompanySelection,
} from './marketing-calendar-state'

const allCompanies = ['srg', 'agc']

describe('marketing calendar company filter', () => {
  it('isolates a company when it is clicked from All', () => {
    expect(toggleCompanySelection([], 'agc', allCompanies)).toEqual(['agc'])
    expect(toggleCompanySelection([], 'srg', allCompanies)).toEqual(['srg'])
  })

  it('returns to All when the last selected company is turned off', () => {
    expect(toggleCompanySelection(['agc'], 'agc', allCompanies)).toEqual([])
  })

  it('canonicalizes selecting every company back to All', () => {
    expect(toggleCompanySelection(['agc'], 'srg', allCompanies)).toEqual([])
  })

  it('preserves valid filters and removes archived company ids on refresh', () => {
    expect(reconcileCompanySelection(['agc', 'archived'], allCompanies)).toEqual(['agc'])
    expect(reconcileCompanySelection(['archived'], allCompanies)).toEqual([])
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
