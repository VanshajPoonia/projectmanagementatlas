import { describe, expect, it } from 'vitest'
import {
  MARKETING_CALENDAR_SELECT,
  toMarketingCalendarSummaries,
} from './marketing-calendar-summary'

describe('marketing calendar summaries', () => {
  it('asks for the membership rows the switcher needs to pick a default', () => {
    // If this embed is ever dropped from the select, every calendar arrives with an empty
    // member list and the switcher silently reverts to "whichever sorts first by name" -
    // the exact bug this shape exists to prevent, and one nothing else would catch.
    expect(MARKETING_CALENDAR_SELECT).toContain('marketing_calendar_members(user_id)')
  })

  it('flattens the embedded rows into a plain id list', () => {
    const [calendar] = toMarketingCalendarSummaries([
      {
        id: 'cal-1',
        name: 'Marketing Calendar',
        color: '#3b82f6',
        is_archived: false,
        marketing_calendar_members: [{ user_id: 'kayla' }, { user_id: 'bobby' }],
      },
    ])

    expect(calendar.member_user_ids).toEqual(['kayla', 'bobby'])
    expect(calendar.name).toBe('Marketing Calendar')
  })

  it('reports no membership rather than throwing when RLS returned none', () => {
    // A calendar an admin reads through the admin bypass, with nobody assigned to it, comes
    // back with an empty embed. That is a real state on production, not an error.
    const [calendar] = toMarketingCalendarSummaries([
      { id: 'cal-2', name: "Kayla's Personal", color: '#ef0b79', is_archived: false, marketing_calendar_members: [] },
    ])

    expect(calendar.member_user_ids).toEqual([])
  })

  it('survives a failed query, which PostgREST reports as null data', () => {
    expect(toMarketingCalendarSummaries(null)).toEqual([])
    expect(toMarketingCalendarSummaries(undefined)).toEqual([])
  })
})
