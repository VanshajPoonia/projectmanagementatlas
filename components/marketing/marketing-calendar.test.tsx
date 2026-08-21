// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, rpcMock, supabaseMock } = vi.hoisted(() => {
  const from = vi.fn()
  const rpc = vi.fn()
  return {
    fromMock: from,
    rpcMock: rpc,
    supabaseMock: { from, rpc },
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

// vitest's jsdom environment points `window` at globalThis, and Node 22 defines its own
// `localStorage` there which is undefined unless --localstorage-file is passed. So in this
// environment neither the bare global nor window.localStorage is a real Storage, and the
// afterEach clear below had been throwing into its own catch since the day it was written.
// Install a minimal in-memory one so the persistence tests can actually observe a write.
const memoryStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }
})()
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
  writable: true,
})

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
  { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false, member_user_ids: ['user-1'] },
]
const noopRefetchCalendars = async () => {}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Like makeQuery, but .eq() actually filters. Used only for marketing_calendar_checks:
// the whole point of the shared-checks tests below is that the component must NOT scope
// that query to the viewer, and a no-op .eq() would let a viewer-scoped query pass too.
function makeFilterableQuery(rows: Array<Record<string, unknown>>) {
  const filters: Array<[string, unknown]> = []
  const query: Record<string, any> = {}
  for (const method of ['select', 'order', 'delete']) {
    query[method] = vi.fn(() => query)
  }
  query.eq = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query })
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({
    data: rows.filter(row => filters.every(([column, value]) => row[column] === value)),
    error: null,
  }).then(resolve, reject)
  return query
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
  let checkRows: Array<Record<string, unknown>>
  // Appended to the shared item fixture. Empty by default so the tests written
  // against the original four rows keep seeing exactly those.
  let extraItems: Array<Record<string, unknown>>
  // One channel by default, for the same reason: the channel-grid view renders a
  // column per channel, so adding a second unconditionally would shift every
  // existing grid assertion.
  let channelRows: Array<Record<string, unknown>>

  beforeEach(() => {
    attachmentLoadError = null
    checkRows = []
    extraItems = []
    channelRows = [{ id: 'ch-social', channel: 'social', label: 'Social', is_archived: false, position: 0 }]
    rpcMock.mockResolvedValue({ data: 0, error: null })
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
            ...extraItems,
          ],
          error: null,
        })
      }
      if (table === 'marketing_calendar_checks') {
        return makeFilterableQuery(checkRows)
      }
      if (table === 'marketing_calendar_attachments') {
        return makeQuery({ data: [], error: attachmentLoadError })
      }
      if (table === 'companies') {
        return makeQuery({ data: companies, error: null })
      }
      if (table === 'marketing_channels') {
        return makeQuery({ data: channelRows, error: null })
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
    rpcMock.mockReset()
    scrollTo.mockReset()
    // The view toggle persists to localStorage, which jsdom keeps for the whole
    // file - without this, one test switching to the channel grid would silently
    // start every later test there.
    try { window.localStorage.clear() } catch { /* ignore */ }
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

  // Checks are stored per (item_id, user_id), but a calendar is shared: what one member
  // marks posted has to read as posted for everyone else looking at the same item.
  // Before this, the load query filtered to the viewer's own rows, so a member who had
  // ticked nothing saw an empty check set - and every past item fell through to
  // auto-missed, which is how Bobby saw "all missed" while Kayla saw "all done".
  it('shows an item another member marked posted as posted', async () => {
    checkRows = [
      { id: 'check-1', item_id: 'srg-post', user_id: 'user-2', checked_at: '2026-08-06T10:00:00Z', status: 'posted', note: null },
    ]

    render(<MarketingCalendar userId="user-1" userName="Bobby" isAdmin calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    await waitFor(() => {
      expect(screen.getAllByLabelText('Mark as not posted').length).toBeGreaterThan(0)
    })
  })

  // Two members can hold conflicting marks on the same shared item; a 'posted' mark is
  // someone stating the content actually went out, so it wins over another member's miss.
  it('resolves a conflicting posted and missed mark in favour of posted', async () => {
    checkRows = [
      { id: 'check-1', item_id: 'srg-post', user_id: 'user-2', checked_at: '2026-08-06T10:00:00Z', status: 'missed', note: 'never went out' },
      { id: 'check-2', item_id: 'srg-post', user_id: 'user-3', checked_at: '2026-08-05T10:00:00Z', status: 'posted', note: null },
    ]

    render(<MarketingCalendar userId="user-1" userName="Bobby" isAdmin calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    await waitFor(() => {
      expect(screen.getAllByLabelText('Mark as not posted').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('never went out')).not.toBeInTheDocument()
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

    // A 3rd date input now exists - the "add a specific date" field in the
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

  // The edit dialog used to expose only date/time/companies/channel/content - a file
  // could be attached at create time or through the separate file dialog, but never
  // from the pane you land in when you click the event.
  it('lets an existing event gain, replace and drop a file from the edit dialog', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('AGC post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    const input = within(dialog).getByLabelText('Choose a file to attach')
    expect(input.getAttribute('accept')).toEqual(expect.stringContaining('application/pdf'))
    expect(within(dialog).getByRole('button', { name: /Choose a file/i })).toBeInTheDocument()
  })

  // Repeat was create-only: a one-off could never become a series, and a series
  // could never be extended, without deleting everything and starting again.
  it('turns a one-off event into a series from the edit dialog', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('AGC post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    expect(within(dialog).getByText('Repeat this event')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'No new dates selected' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }))
    // Derived from the same clock as the item fixture rather than written as
    // literals. Hardcoding the anchor made this pass only on the day the two
    // happened to coincide, then fail once the date rolled over.
    const anchor = toDateKey(new Date())
    const threeWeeksOut = toDateKey(new Date(Date.now() + 21 * 86400000))
    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: anchor } })          // the event's own date
    fireEvent.change(dateInputs[1], { target: { value: threeWeeksOut } })   // repeat until

    // The anchor already exists, so only the three later weekly dates are new.
    const addButton = await within(dialog).findByRole('button', { name: 'Add 3 dates' })
    expect(addButton).toBeEnabled()
  })

  it('lists a series\' dates and removes one without touching the rest', async () => {
    const today = toDateKey(new Date())
    const nextWeek = toDateKey(new Date(Date.now() + 7 * 86400000))
    const weekAfter = toDateKey(new Date(Date.now() + 14 * 86400000))
    extraItems = [nextWeek, weekAfter].map((date, i) => ({
      id: `srg-post-week-${i + 2}`,
      date,
      day_label: 'NEXT',
      channel: 'social',
      content: 'SRG post',
      is_highlighted: false,
      position: 0,
      source_sheet: null,
      recurrence_group_id: 'series-1',
      marketing_calendar_item_companies: [{ company: companies[0] }],
    }))

    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('SRG post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    expect(within(dialog).getByText('Dates in this series (3)')).toBeInTheDocument()

    // The occurrence being edited has no remove control - the dialog's Delete
    // button is what removes that one, and it has to close the dialog.
    expect(within(dialog).queryByLabelText(`Remove ${today} from the series`)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText(`Remove ${nextWeek} from the series`))

    await waitFor(() => {
      expect(within(dialog).getByText('Dates in this series (2)')).toBeInTheDocument()
    })
    expect(within(dialog).queryByLabelText(`Remove ${nextWeek} from the series`)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(`Remove ${weekAfter} from the series`)).toBeInTheDocument()
    // The dialog stays open on the event you were editing.
    expect(screen.getByRole('dialog', { name: /Edit Marketing Event/i })).toBeInTheDocument()
  })

  // Channel was single-select on edit, so the only thing you could do was move an
  // event to a different channel. "Also post this to email" meant deleting the
  // event and recreating it from scratch.
  it('adds a channel to an existing event and says what saving will do', async () => {
    channelRows = [
      { id: 'ch-social', channel: 'social', label: 'Social', is_archived: false, position: 0 },
      { id: 'ch-email', channel: 'email', label: 'Email', is_archived: false, position: 1 },
    ]
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('AGC post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    expect(within(dialog).getByText('Channels')).toBeInTheDocument()

    // The event's own channel starts ticked; adding a second is additive, not a swap.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Email' }))
    const notice = await within(dialog).findByText(/On save:/)
    expect(notice).toHaveTextContent('adds Email across 1 date')
    expect(notice).not.toHaveTextContent('deletes')
    expect(within(dialog).getByRole('button', { name: 'Save event' })).toBeEnabled()
  })

  // Swapping one channel for another has to stay a rename of the existing rows.
  // Recreating them would silently discard every check-off and attachment.
  it('treats one channel out and one in as a move, not a delete and recreate', async () => {
    channelRows = [
      { id: 'ch-social', channel: 'social', label: 'Social', is_archived: false, position: 0 },
      { id: 'ch-email', channel: 'email', label: 'Email', is_archived: false, position: 1 },
    ]
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('AGC post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Email' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))

    const notice = await within(dialog).findByText(/Moves this event/)
    expect(notice).toHaveTextContent('from Social to Email')
    expect(notice).toHaveTextContent('Check-offs and attachments come with it')
  })

  // Column order lives in marketing_channels.position, which the whole calendar
  // reads - rearranging is a write for everyone, not a local view preference. It
  // goes through the reorder RPC because a direct UPDATE is admin-only and, read
  // literally, excludes the super_admins who actually use this calendar.
  describe('channel grid column order', () => {
    const twoChannels = () => [
      { id: 'ch-social', channel: 'social', label: 'Social', is_archived: false, position: 0 },
      { id: 'ch-email', channel: 'email', label: 'Email', is_archived: false, position: 1 },
    ]
    const headerOrder = () =>
      screen.getAllByRole('columnheader').map(header => header.textContent?.trim())

    async function renderChannelGrid() {
      channelRows = twoChannels()
      render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)
      await screen.findByText("Kayla's Posting Board")
      fireEvent.click(screen.getByRole('button', { name: 'Channels' }))
      expect(headerOrder()).toEqual(['Date', 'Social', 'Email'])
    }

    it('moves a column with the arrows and persists the new order', async () => {
      await renderChannelGrid()

      fireEvent.click(screen.getByRole('button', { name: 'Move Email left' }))

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith('reorder_marketing_channels', {
          p_channel_ids: ['ch-email', 'ch-social'],
        })
      })
      expect(headerOrder()).toEqual(['Date', 'Email', 'Social'])
    })

    it('moves a column when its header is dragged onto another', async () => {
      await renderChannelGrid()

      const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' }
      const [, social, email] = screen.getAllByRole('columnheader')
      fireEvent.dragStart(email, { dataTransfer })
      fireEvent.dragOver(social, { dataTransfer })
      fireEvent.drop(social, { dataTransfer })

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith('reorder_marketing_channels', {
          p_channel_ids: ['ch-email', 'ch-social'],
        })
      })
      expect(headerOrder()).toEqual(['Date', 'Email', 'Social'])
    })

    // The optimistic move must not outlive a rejected write - the likeliest
    // rejection is a stale list, and leaving the new order on screen would show
    // every other member an order the database never accepted.
    it('puts the columns back when the order cannot be saved', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'Channel ordering is stale' } })
      await renderChannelGrid()

      fireEvent.click(screen.getByRole('button', { name: 'Move Email left' }))

      await waitFor(() => expect(rpcMock).toHaveBeenCalled())
      await waitFor(() => expect(headerOrder()).toEqual(['Date', 'Social', 'Email']))
    })

    // Both ends of the row: nothing to swap with, so no write to send.
    it('does not offer a move past either end of the grid', async () => {
      await renderChannelGrid()

      expect(screen.getByRole('button', { name: 'Move Social left' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move Email right' })).toBeDisabled()
      expect(rpcMock).not.toHaveBeenCalled()
    })
  })

  // Dropping the last channel would delete the event out from under a form whose
  // Save button reads as an edit, so it has to be unreachable.
  it('cannot save an event with no channel selected', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={defaultCalendars} refetchCalendars={noopRefetchCalendars} />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByText('AGC post')[0].closest('[role="button"]')!)

    const dialog = await screen.findByRole('dialog', { name: /Edit Marketing Event/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Save event' })).toBeDisabled()
    })
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
      { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false, member_user_ids: ['user-1'] },
      { id: 'cal-2', name: 'Q1 Campaigns', color: '#dc2626', is_archived: false, member_user_ids: [] },
    ]
    render(<MarketingCalendar userId="user-1" userName="Kayla" calendars={twoCalendars} refetchCalendars={noopRefetchCalendars} />)

    const select = await screen.findByLabelText('Select calendar')
    expect(within(select).getByText("Kayla's Posting Board")).toBeInTheDocument()
    expect(within(select).getByText('Q1 Campaigns')).toBeInTheDocument()
  })

  // Production shape: an admin reads every calendar through the SELECT policy, the list is
  // ordered by name, and the alphabetically first one is somebody else's empty personal
  // calendar. Opening Marketing used to land there every single time.
  const adminsView = [
    { id: 'cal-personal', name: "Kayla's Personal", color: '#ef0b79', is_archived: false, member_user_ids: [] },
    { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false, member_user_ids: ['user-1'] },
  ]

  it('opens a calendar the viewer belongs to, not whichever sorts first', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin calendars={adminsView} refetchCalendars={noopRefetchCalendars} />)

    const select = await screen.findByLabelText('Select calendar') as HTMLSelectElement
    expect(select.value).toBe('cal-1')
  })

  it('remembers the calendar the viewer switched to', async () => {
    const { unmount } = render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin calendars={adminsView} refetchCalendars={noopRefetchCalendars} />)

    fireEvent.change(await screen.findByLabelText('Select calendar'), { target: { value: 'cal-personal' } })
    unmount()

    render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin calendars={adminsView} refetchCalendars={noopRefetchCalendars} />)
    const select = await screen.findByLabelText('Select calendar') as HTMLSelectElement
    expect(select.value).toBe('cal-personal')
  })

  it('does not hand one user the calendar another chose in the same browser', async () => {
    const shared = [
      { id: 'cal-personal', name: "Kayla's Personal", color: '#ef0b79', is_archived: false, member_user_ids: [] },
      { id: 'cal-1', name: "Kayla's Posting Board", color: '#3b82f6', is_archived: false, member_user_ids: ['user-1', 'user-2'] },
    ]
    const { unmount } = render(<MarketingCalendar userId="user-1" userName="Kayla" isAdmin calendars={shared} refetchCalendars={noopRefetchCalendars} />)
    fireEvent.change(await screen.findByLabelText('Select calendar'), { target: { value: 'cal-personal' } })
    unmount()

    render(<MarketingCalendar userId="user-2" userName="Bobby" isAdmin calendars={shared} refetchCalendars={noopRefetchCalendars} />)
    const select = await screen.findByLabelText('Select calendar') as HTMLSelectElement
    expect(select.value).toBe('cal-1')
    expect(window.localStorage.getItem('marketing_calendar_selected:user-2')).toBeNull()
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
