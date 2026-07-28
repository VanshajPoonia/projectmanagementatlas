import { describe, expect, it } from 'vitest'
import {
  buildRecurringDateKeys,
  buildRecurringSeriesScheduleUpdates,
  centeredScrollLeft,
  dayLabelForDateKey,
  isImportedWeekendPlaceholder,
  MAX_SCHEDULED_MARKETING_POSTS,
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

describe('recurring marketing event editing', () => {
  it('moves every repeat by the same date offset', () => {
    expect(buildRecurringSeriesScheduleUpdates(
      [
        { id: 'first', date: '2026-07-28', channel: 'social' },
        { id: 'second', date: '2026-08-04', channel: 'social' },
        { id: 'third', date: '2026-08-11', channel: 'social' },
      ],
      {
        anchorDate: '2026-07-28',
        nextDate: '2026-07-30',
        anchorChannel: 'social',
        nextChannel: 'instagram',
      },
    )).toEqual([
      { id: 'first', date: '2026-07-30', day_label: 'THU', channel: 'instagram' },
      { id: 'second', date: '2026-08-06', day_label: 'THU', channel: 'instagram' },
      { id: 'third', date: '2026-08-13', day_label: 'THU', channel: 'instagram' },
    ])
  })

  it('keeps other channel streams intact while moving their dates', () => {
    expect(buildRecurringSeriesScheduleUpdates(
      [
        { id: 'social', date: '2026-07-31', channel: 'social' },
        { id: 'email', date: '2026-07-31', channel: 'email' },
      ],
      {
        anchorDate: '2026-07-31',
        nextDate: '2026-08-01',
        anchorChannel: 'social',
        nextChannel: 'instagram',
      },
    )).toEqual([
      { id: 'social', date: '2026-08-01', day_label: 'SAT', channel: 'instagram' },
      { id: 'email', date: '2026-08-01', day_label: 'SAT', channel: 'email' },
    ])
  })
})

describe('recurring marketing event creation', () => {
  it('matches the screenshot weekly range using an inclusive cutoff', () => {
    const dates = buildRecurringDateKeys(
      '2026-07-31',
      'weekly',
      '2026-12-31',
    )

    expect(dates).toHaveLength(22)
    expect(dates.slice(0, 3)).toEqual([
      '2026-07-31',
      '2026-08-07',
      '2026-08-14',
    ])
    expect(dates.at(-1)).toBe('2026-12-25')
    expect(dates.every(date => dayLabelForDateKey(date) === 'FRI')).toBe(true)
  })

  it('does not silently stop daily schedules after 104 dates', () => {
    const dates = buildRecurringDateKeys(
      '2026-07-31',
      'daily',
      '2026-12-31',
    )

    expect(dates).toHaveLength(154)
    expect(dates.at(-1)).toBe('2026-12-31')
  })

  it('keeps the original day-of-month after a short month', () => {
    expect(buildRecurringDateKeys(
      '2027-01-31',
      'monthly',
      '2027-05-31',
    )).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ])
  })

  it('handles leap years and quarterly month-end clamping', () => {
    expect(buildRecurringDateKeys(
      '2028-01-31',
      'monthly',
      '2028-03-31',
    )).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ])

    expect(buildRecurringDateKeys(
      '2026-11-30',
      'quarterly',
      '2027-08-31',
    )).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
      '2027-08-30',
    ])
  })

  it('returns no dates for invalid or reversed ranges', () => {
    expect(buildRecurringDateKeys('2026-02-30', 'daily', '2026-03-10')).toEqual([])
    expect(buildRecurringDateKeys('2026-08-01', 'weekly', '2026-07-01')).toEqual([])
  })

  it('returns one extra date so oversized schedules can be rejected explicitly', () => {
    const dates = buildRecurringDateKeys(
      '2020-01-01',
      'daily',
      '2030-01-01',
    )
    expect(dates).toHaveLength(MAX_SCHEDULED_MARKETING_POSTS + 1)
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
