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

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'order']) {
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

  beforeEach(() => {
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
    render(<MarketingCalendar userId="user-1" userName="Kayla" />)

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

  it('returns to the current week and reveals todays column', async () => {
    const { container } = render(<MarketingCalendar userId="user-1" userName="Kayla" />)

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
    const { container } = render(<MarketingCalendar userId="user-1" userName="Kayla" />)

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
    render(<MarketingCalendar userId="user-1" userName="Kayla" />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('previews exact recurrence dates separately from channel post count', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))

    const dialog = await screen.findByRole('dialog')
    const firstDateInput = dialog.querySelector<HTMLInputElement>('input[type="date"]')
    expect(firstDateInput).not.toBeNull()
    fireEvent.change(firstDateInput!, { target: { value: '2026-07-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Social' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Weekly' }))

    const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')
    expect(dateInputs).toHaveLength(2)
    fireEvent.change(dateInputs[1], { target: { value: '2026-12-31' } })

    expect(within(dialog).getByText(
      /22 recurring dates × 1 channel = 22 scheduled posts/,
    )).toBeInTheDocument()
    expect(within(dialog).getByText(
      /The end date is a cutoff\. The last matching weekly date is Fri, Dec 25\./,
    )).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create series' })).toBeInTheDocument()
  })

  it('opens a separate image attachment space for an event', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" />)

    await screen.findByText("Kayla's Posting Board")
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach an image' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Social media image' })
    expect(within(dialog).getByText(/belongs only to this calendar event/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Choose an image/i })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Choose a social media image')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,image/gif',
    )
  })

  it('lets a recurring event target one occurrence or the entire series', async () => {
    render(<MarketingCalendar userId="user-1" userName="Kayla" />)

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
})
