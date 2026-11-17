import { describe, expect, it } from 'vitest'
import {
  entryDurationMs,
  formatClock,
  formatDuration,
  rangeStarts,
  runningEntry,
  spokenDuration,
  toCsv,
  totals,
  type TimeEntry,
} from './time-tracking'

// Built from local wall-clock times so every case holds under `pnpm test:timezones`.
function local(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 10, day, hour, minute)
}

function entry(id: string, start: Date, end: Date | null, note: string | null = null): TimeEntry {
  return { id, started_at: start.toISOString(), ended_at: end ? end.toISOString() : null, note }
}

const HOUR = 3_600_000

describe('rangeStarts', () => {
  it('starts the week on Monday', () => {
    // 2026-11-18 is a Wednesday, 2026-11-16 the Monday before it.
    const { today, week, month } = rangeStarts(local(18, 15))
    expect(today).toEqual(local(18, 0))
    expect(week).toEqual(local(16, 0))
    expect(month).toEqual(new Date(2026, 10, 1))
  })

  it('treats Sunday as the last day of the week, not the first', () => {
    // 2026-11-22 is a Sunday.
    expect(rangeStarts(local(22, 9)).week).toEqual(local(16, 0))
  })
})

describe('totals', () => {
  it('clips a session that crosses midnight into both days', () => {
    const now = local(18, 12)
    const crossing = entry('a', local(17, 22), local(18, 2))
    const t = totals([crossing], now)
    expect(t.today).toBe(2 * HOUR)
    expect(t.week).toBe(4 * HOUR)
    expect(t.all).toBe(4 * HOUR)
  })

  it('counts a running entry up to now', () => {
    const now = local(18, 11, 30)
    const t = totals([entry('a', local(18, 10), null)], now)
    expect(t.today).toBe(1.5 * HOUR)
  })

  it('keeps last week out of this week but in this month and all time', () => {
    const now = local(18, 12)
    const t = totals([entry('a', local(10, 9), local(10, 12))], now)
    expect(t.today).toBe(0)
    expect(t.week).toBe(0)
    expect(t.month).toBe(3 * HOUR)
    expect(t.all).toBe(3 * HOUR)
  })

  it('is zero for no entries', () => {
    expect(totals([], local(18, 12))).toEqual({ today: 0, week: 0, month: 0, all: 0 })
  })
})

describe('entryDurationMs', () => {
  it('never goes negative when the clock disagrees', () => {
    expect(entryDurationMs(entry('a', local(18, 12), null), local(18, 11))).toBe(0)
  })
})

describe('runningEntry', () => {
  it('finds the entry with no end', () => {
    const running = entry('b', local(18, 10), null)
    expect(runningEntry([entry('a', local(17, 9), local(17, 10)), running])).toBe(running)
    expect(runningEntry([entry('a', local(17, 9), local(17, 10))])).toBeNull()
  })
})

describe('formatting', () => {
  it('formats the live clock', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(3723_000)).toBe('1:02:03')
    expect(formatClock(-5)).toBe('0:00:00')
  })

  it('formats totals in hours and minutes', () => {
    expect(formatDuration(0)).toBe('0h 00m')
    expect(formatDuration(3 * HOUR + 5 * 60_000 + 59_000)).toBe('3h 05m')
  })

  it('reads well aloud', () => {
    expect(spokenDuration(65 * 60_000)).toBe('1 hour 5 minutes')
    expect(spokenDuration(60_000)).toBe('1 minute')
    expect(spokenDuration(2 * HOUR)).toBe('2 hours 0 minutes')
  })
})

describe('toCsv', () => {
  it('lists entries oldest first with decimal hours and escapes notes', () => {
    const now = local(18, 12)
    const csv = toCsv(
      [
        entry('b', local(18, 9), local(18, 10, 30), 'Edit "listing" reel, v2'),
        entry('a', local(17, 9), local(17, 10)),
      ],
      now,
    ).split('\n')
    expect(csv[0]).toBe('started_at,ended_at,hours,note')
    expect(csv[1]).toContain(',1.00,')
    expect(csv[2]).toContain(',1.50,"Edit ""listing"" reel, v2"')
  })

  it('leaves the end blank for a running entry', () => {
    const csv = toCsv([entry('a', local(18, 11), null)], local(18, 12)).split('\n')
    expect(csv[1]).toMatch(/^[^,]+,,1\.00,$/)
  })
})
