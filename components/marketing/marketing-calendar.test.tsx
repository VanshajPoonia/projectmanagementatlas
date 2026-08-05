// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, supabaseMock } = vi.hoisted(() => {
  const from = vi.fn()
  return {
    fromMock: from,
    supabaseMock: { from },
  }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabaseMock,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import MarketingCalendar from './marketing-calendar'

const companies = [
  { id: 'srg', code: 'SRG', name: 'SRG', color: '#2563eb', position: 0, is_archived: false },
  { id: 'agc', code: 'AGC', name: 'AGC', color: '#dc2626', position: 1, is_archived: false },
]

// Calendars are now admin-creatable, named, multiple instances (migration 085) passed down as a
// prop from the parent dashboard's useMarketingCalendars() hook, rather than a single implicit
// calendar the component resolved itself. Named to match this suite's existing header assertions
// ("Kayla's Posting Board") so the 13 pre-existing render() sites below only need this one new
// prop, not a rewrite of every assertion.
const defaultCalendars = [
  { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false },
]
const noopRefetchCalendars = async () => {}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'order', 'delete']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('MarketingCalendar controls', () => {
  const originalScrollTo = HTMLElement.prototype.scrollTo
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  const scrollTo = vi.fn()
  let attachmentLoadError: { code: string; message: string } | null

  beforeEach(() => {
    attachmentLoadError = null
    const now = new Date()
    const today = toDateKey(now)
    const nextSaturday = new Date(now)
    nextSaturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7))
    const weekend = toDateKey(nextSaturday)
    fromMock.mockImplementation((table: string) => {
      if (table === 'marketing_calendar_items') {
        return makeQuery({
          data: [
            {
              id: 'srg-post',
              date: today,
              day_label: 'TODAY',
              channel: 'social',
              content: 'SRG post',
              is_highlighted: false,
              position: 0,
              source_sheet: null,
              recurrence_group_id: 'series-1',
              marketing_calendar_item_companies: [{ company: companies[0] }],
            },
            {
              id: 'agc-post',
              date: today,
              day_label: 'TODAY',
              channel: 'social',
              content: 'AGC post',
              is_highlighted: false,
              position: 1,
              source_sheet: null,
              recurrence_group_id: null,
              marketing_calendar_item_companies: [{ company: companies[1] }],
            },
            {
              id: 'weekend-placeholder',
              date: weekend,
              day_label: 'SAT',
              channel: 'social',
              content: 'wk',
              is_highlighted: false,
              position: 2,
              source_sheet: '2026 Calendar',
              recurrence_group_id: null,
              marketing_calendar_item_companies: [{ company: companies[0] }],
            },
            {
              id: 'real-weekend-post',
              date: weekend,
              day_label: 'SAT',
              channel: 'social',
              content: 'Weekend campaign',
              is_highlighted: false,
              position: 3,
              source_sheet: '2026 Calendar',
              recurrence_group_id: null,
              marketing_calendar_item_companies: [{ company: companies[0] }],
            },
          ],
          error: null,
        })
      }
      if (table === 'marketing_calendar_checks') {
        return makeQuery({ data: [], error: null })
      }
      if (table === 'marketing_calendar_attachments') {
        return makeQuery({ data: [], error: attachmentLoadError })
      }
      if (table === 'companies') {
        return makeQuery({ data: companies, error: null })
      }
      if (table === 'marketing_channels') {
        return makeQuery({
          data: [{ channel: 'social', label: 'Social', is_archived: false, position: 0 }],
          error: null,
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    window.requestAnimationFrame = callback => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    fromMock.mockReset()
    scrollTo.mockReset()
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    })
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('filters to the company named on the clicked button', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'AGC' }))

    await waitFor(() => {
      expect(screen.queryAllByText('AGC post').length).toBeGreaterThan(0)
      expect(screen.queryAllByText('SRG post')).toHaveLength(0)
    })
    expect(screen.getByRole('button', { name: 'AGC' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => {
      expect(screen.queryAllByText('AGC post').length).toBeGreaterThan(0)
      expect(screen.queryAllByText('SRG post').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'SRG' }))
    await waitFor(() => {
      expect(screen.queryAllByText('SRG post').length).toBeGreaterThan(0)
      expect(screen.queryAllByText('AGC post')).toHaveLength(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'AGC' }))
    await waitFor(() => {
      expect(screen.queryAllByText('AGC post').length).toBeGreaterThan(0)
      expect(screen.queryAllByText('SRG post')).toHaveLength(0)
    })
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'AGC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps events visible when optional attachment metadata is unavailable', async () => {
    attachmentLoadError = {
      code: 'PGRST205',
      message: "Could not find the table 'public.marketing_calendar_attachments' in the schema cache",
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    expect(screen.queryAllByText('SRG post').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('AGC post').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Marketing calendar is empty/i)).not.toBeInTheDocument()
    expect(console.warn).toHaveBeenCalledWith(
      '[marketing-calendar] Attachment metadata is unavailable',
      expect.objectContaining({ code: 'PGRST205' }),
    )
  })

  it('returns to the current week and reveals todays column', async () => {
    const { container } = render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    const weekScroll = container.querySelector<HTMLElement>('[data-marketing-week-scroll]')
    const todayColumn = container.querySelector<HTMLElement>(`[data-calendar-date="${toDateKey(new Date())}"]`)
    expect(weekScroll).not.toBeNull()
    expect(todayColumn).not.toBeNull()

    Object.defineProperty(weekScroll!, 'scrollLeft', { configurable: true, value: 640 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-marketing-week-scroll')) {
        return {
          left: 80, right: 440, top: 0, bottom: 360,
          width: 360, height: 360, x: 80, y: 0,
          toJSON: () => ({}),
        }
      }
      if (this.dataset.calendarDate === toDateKey(new Date())) {
        return {
          left: 410, right: 560, top: 0, bottom: 360,
          width: 150, height: 360, x: 410, y: 0,
          toJSON: () => ({}),
        }
      }
      return {
        left: 0, right: 0, top: 0, bottom: 0,
        width: 0, height: 0, x: 0, y: 0,
        toJSON: () => ({}),
      }
    })

    const nextWeek = screen.getByRole('button', { name: 'Next week' })
    const weekLabel = nextWeek.previousElementSibling
    const currentWeekLabel = weekLabel?.textContent

    fireEvent.click(nextWeek)
    expect(weekLabel?.textContent).not.toBe(currentWeekLabel)

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    await waitFor(() => {
      expect(weekLabel?.textContent).toBe(currentWeekLabel)
      expect(scrollTo).toHaveBeenCalledWith({ left: 865, behavior: 'auto' })
    })
  })

  it('shows a navigable 42-day month view without imported wk placeholders', async () => {
    const { container } = render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    expect(screen.queryByText(/^wk$/i)).not.toBeInTheDocument()
    expect(screen.queryAllByText('Weekend campaign').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')
    const monthCells = [...container.querySelectorAll<HTMLElement>('[data-month-date]')]
    expect(monthCells).toHaveLength(42)
    expect(new Set(monthCells.map(cell => cell.dataset.monthDate)).size).toBe(42)
    for (const weekday of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getAllByText(weekday).length).toBeGreaterThan(0)
    }

    const nextMonth = screen.getByRole('button', { name: 'Next month' })
    const monthLabel = nextMonth.previousElementSibling
    const currentMonthLabel = monthLabel?.textContent

    fireEvent.click(nextMonth)
    expect(monthLabel?.textContent).not.toBe(currentMonthLabel)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() => expect(monthLabel?.textContent).toBe(currentMonthLabel))

    const todayLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date())
    const addToday = screen.getByRole('button', { name: `Add event on ${todayLabel}` })
    expect(addToday).toHaveAttribute('aria-current', 'date')
    fireEvent.click(addToday)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByDisplayValue(toDateKey(new Date()))).toBeInTheDocument()
  })

  it('keeps the create form inside a viewport-capped scrollable dialog', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('previews exact recurrence dates separately from channel post count', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    const firstDateInput = dialog.querySelector<HTMLInputElement>('input[type="date"]')
    expect(firstDateInput).not.toBeNull()
    fireEvent.change(firstDateInput!, { target: { value: '2026-07-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }))

    // A 3rd date input now exists — the "add a specific date" field in the
    // skip/add schedule editor, which renders whenever a repeat is active.
    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    expect(dateInputs).toHaveLength(3)
    fireEvent.change(dateInputs[1], { target: { value: '2026-12-31' } })

    expect(within(dialog).getByText(
      /22 recurring dates × 1 channel = 22 scheduled posts/,
    )).toBeInTheDocument()
    expect(within(dialog).getByText(
      /The end date is a cutoff\. The last matching weekly date is Fri, Dec 25\./,
    )).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create series' })).toBeInTheDocument()
  })

  it('lets a Custom pattern generate dates from selected weekdays', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    const firstDateInput = dialog.querySelector<HTMLInputElement>('input[type="date"]')
    fireEvent.change(firstDateInput!, { target: { value: '2026-07-28' } }) // Tue
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Custom' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tue' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu' }))

    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-11' } }) // repeat-until (Tue)

    expect(within(dialog).getByText(
      /5 recurring dates × 1 channel = 5 scheduled posts/,
    )).toBeInTheDocument()
  })

  it('lets a generated date be skipped before creating', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    const firstDateInput = dialog.querySelector<HTMLInputElement>('input[type="date"]')
    fireEvent.change(firstDateInput!, { target: { value: '2026-07-31' } }) // Fri
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }))

    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-14' } })

    expect(within(dialog).getByText(
      /3 recurring dates × 1 channel = 3 scheduled posts/,
    )).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip 2026-07-31' }))

    expect(within(dialog).getByText(
      /2 recurring dates × 1 channel = 2 scheduled posts/,
    )).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Include 2026-07-31' }))

    expect(within(dialog).getByText(
      /3 recurring dates × 1 channel = 3 scheduled posts/,
    )).toBeInTheDocument()
  })

  it('lets a specific extra date be added to a schedule', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    const firstDateInput = dialog.querySelector<HTMLInputElement>('input[type="date"]')
    fireEvent.change(firstDateInput!, { target: { value: '2026-07-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }))

    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-14' } }) // repeat-until
    fireEvent.change(dateInputs[2], { target: { value: '2026-09-01' } }) // add-a-date field
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add date' }))

    expect(within(dialog).getByText(
      /4 recurring dates × 1 channel = 4 scheduled posts/,
    )).toBeInTheDocument()
    expect(within(dialog).getByText(/added/)).toBeInTheDocument()
  })

  it('opens a separate file attachment space for an event', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach a file' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Event file' })
    expect(within(dialog).getByText(/belongs only to this calendar event/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Choose a file/i })).toBeInTheDocument()
    const input = within(dialog).getByLabelText('Choose an event file')
    expect(input.getAttribute('accept')).toEqual(expect.stringContaining('application/pdf'))
    expect(input.getAttribute('accept')).toEqual(expect.stringContaining('video/mp4'))
    expect(input.getAttribute('accept')).toEqual(expect.stringContaining('.heic'))
    expect(within(dialog).getByText(/up to 50 MB/i)).toBeInTheDocument()
  })

  it('lets a recurring event target one occurrence or the entire series', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    const recurringEvent = screen.getAllByText('SRG post')[0].closest('[role="button"]')
    expect(recurringEvent).not.toBeNull()
    fireEvent.click(recurringEvent!)

    const dialog = await screen.findByRole('dialog')
    const entireSeries = within(dialog).getByRole('button', { name: /Entire series/i })
    const thisEvent = within(dialog).getByRole('button', { name: /^This event/i })
    expect(entireSeries).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Save series' })).toBeInTheDocument()

    fireEvent.click(thisEvent)
    expect(thisEvent).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: 'Save event' })).toBeInTheDocument()
  })

  it('deletes every occurrence when "Entire series" is selected and confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    const recurringEvent = screen.getAllByText('SRG post')[0].closest('[role="button"]')
    fireEvent.click(recurringEvent!)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Entire series/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete series' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const seriesDeleteQuery = fromMock.mock.results
      .filter((_result, i) => fromMock.mock.calls[i][0] === 'marketing_calendar_items')
      .map(result => result.value)
      .find(query => query.delete.mock.calls.length > 0)

    expect(seriesDeleteQuery).toBeDefined()
    expect(seriesDeleteQuery.eq).toHaveBeenCalledWith('recurrence_group_id', 'series-1')
    expect(screen.queryByText('SRG post')).not.toBeInTheDocument()
  })

  it('deletes only the one occurrence when "This event" is selected on a recurring event', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    const recurringEvent = screen.getAllByText('SRG post')[0].closest('[role="button"]')
    fireEvent.click(recurringEvent!)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^This event/i }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete this event only' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const singleDeleteQuery = fromMock.mock.results
      .filter((_result, i) => fromMock.mock.calls[i][0] === 'marketing_calendar_items')
      .map(result => result.value)
      .find(query => query.delete.mock.calls.length > 0)

    expect(singleDeleteQuery).toBeDefined()
    expect(singleDeleteQuery.eq).toHaveBeenCalledWith('id', 'srg-post')
    expect(screen.queryByText('SRG post')).not.toBeInTheDocument()
  })

  it('hides the calendar switcher when only one calendar is available', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    expect(screen.queryByLabelText('Select calendar')).not.toBeInTheDocument()
  })

  it('shows a calendar switcher listing every available calendar', async () => {
    const twoCalendars = [
      { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false },
      { id: 'cal-2', name: 'Q1 Campaigns', color: '#dc2626', is_archived: false },
    ]
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={twoCalendars} refetchCalendars={noopRefetchCalendars} />)

    const select = await screen.findByLabelText('Select calendar')
    expect(within(select).getByText("Kayla's Posting Board")).toBeInTheDocument()
    expect(within(select).getByText('Q1 Campaigns')).toBeInTheDocument()
  })

  it('tells a non-admin with no calendar access to ask an admin, with no create option', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin={false} calendars={[]} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText('No marketing calendar access yet')
    expect(screen.getByText(/Ask an admin to add you/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create calendar' })).not.toBeInTheDocument()
  })

  it('offers a create-calendar option to an admin with no calendars yet', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin calendars={[]} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText('No marketing calendars yet')
    expect(screen.getByRole('button', { name: 'Create calendar' })).toBeInTheDocument()
  })
})
