/**
 * Company filters are exclusive: clicking another company switches directly
 * to it, while clicking the active company returns to All.
 */
export function toggleCompanySelection(
  activeCompanyIds: string[],
  companyId: string,
) {
  return activeCompanyIds.length === 1 && activeCompanyIds[0] === companyId
    ? []
    : [companyId]
}

export function reconcileCompanySelection(
  activeCompanyIds: string[],
  availableCompanyIds: string[],
) {
  if (activeCompanyIds.length === 0) return []

  const next = activeCompanyIds.filter(id => availableCompanyIds.includes(id))
  return next.length > 0 ? [next[next.length - 1]] : []
}

export type MarketingRecurrencePattern =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'custom'

export const MAX_SCHEDULED_MARKETING_POSTS = 1000

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function dateKeyAsUtc(dateKey: string) {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) return null

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null

  return date
}

function utcDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function addUtcDays(anchor: Date, days: number) {
  const date = new Date(anchor)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

/**
 * Adds months from the original anchor, clamping to the target month's last
 * day. Calculating every occurrence from the anchor prevents Jan 31 → Feb 28
 * → Mar 28 drift; the March occurrence returns to Mar 31.
 */
function addUtcMonthsClamped(anchor: Date, months: number) {
  const target = new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + months,
    1,
  ))
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  target.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
  return target
}

/**
 * Builds date-only recurrence keys. All math is UTC and anchor-based, so the
 * schedule cannot move across a daylight-saving boundary or drift after a
 * short month. The end date is an inclusive cutoff: it appears only when it
 * lands on the recurrence itself.
 */
export function buildRecurringDateKeys(
  startDateKey: string,
  pattern: Exclude<MarketingRecurrencePattern, 'custom'>,
  endDateKey: string,
  maxDates = MAX_SCHEDULED_MARKETING_POSTS + 1,
) {
  const start = dateKeyAsUtc(startDateKey)
  const end = dateKeyAsUtc(pattern === 'none' ? startDateKey : endDateKey)
  if (!start || !end || start > end || maxDates <= 0) return []
  if (pattern === 'none') return [startDateKey]

  const dates: string[] = []
  for (let occurrence = 0; occurrence < maxDates; occurrence++) {
    let date: Date
    if (pattern === 'daily') date = addUtcDays(start, occurrence)
    else if (pattern === 'weekly') date = addUtcDays(start, occurrence * 7)
    else if (pattern === 'biweekly') date = addUtcDays(start, occurrence * 14)
    else if (pattern === 'monthly') date = addUtcMonthsClamped(start, occurrence)
    else date = addUtcMonthsClamped(start, occurrence * 3)

    if (date > end) break
    dates.push(utcDateKey(date))
  }
  return dates
}

/**
 * Builds date keys for the "Custom" pattern: every date in range whose UTC
 * weekday is in `weekdays`. Unlike the appointment restriction engine (where
 * an empty weekday set means "every day, once"), an empty set here returns no
 * dates rather than defaulting to daily — "Custom" with nothing checked would
 * otherwise be indistinguishable from the adjacent Daily button, and silently
 * over-posting on a forgotten checkbox is worse than the button staying
 * disabled. Requiring at least one weekday also bounds the day-by-day walk to
 * a small, deterministic iteration count regardless of how wide the range is.
 */
export function buildCustomWeekdayDateKeys(
  startDateKey: string,
  endDateKey: string,
  weekdays: number[],
  maxDates = MAX_SCHEDULED_MARKETING_POSTS + 1,
) {
  const start = dateKeyAsUtc(startDateKey)
  const end = dateKeyAsUtc(endDateKey)
  if (!start || !end || start > end || weekdays.length === 0 || maxDates <= 0) return []

  const weekdaySet = new Set(weekdays)
  const dates: string[] = []
  let cursor = start

  while (cursor <= end && dates.length < maxDates) {
    if (weekdaySet.has(cursor.getUTCDay())) dates.push(utcDateKey(cursor))
    cursor = addUtcDays(cursor, 1)
  }

  return dates
}

export function dayLabelForDateKey(dateKey: string) {
  const date = dateKeyAsUtc(dateKey)
  return date ? DAY_LABELS[date.getUTCDay()] : ''
}

interface CenteredScrollLeftInput {
  currentScrollLeft: number
  containerLeft: number
  containerWidth: number
  targetLeft: number
  targetWidth: number
}

/**
 * Uses viewport-relative rectangles so the result remains correct when the
 * scroll area is nested inside positioned dashboard containers.
 */
export function centeredScrollLeft({
  currentScrollLeft,
  containerLeft,
  containerWidth,
  targetLeft,
  targetWidth,
}: CenteredScrollLeftInput) {
  return Math.max(
    0,
    currentScrollLeft
      + targetLeft
      - containerLeft
      - (containerWidth - targetWidth) / 2,
  )
}

interface RecurringSeriesItem {
  id: string
  date: string
  channel: string
}

interface RecurringSeriesEdit {
  anchorDate: string
  nextDate: string
  anchorChannel: string
  nextChannel: string
}

export interface RecurringSeriesScheduleUpdate {
  id: string
  date: string
  day_label: string
  channel: string
}

/**
 * Shifts every occurrence by the same number of calendar days. Using UTC date
 * math avoids daylight-saving transitions changing the offset.
 *
 * When a series was created for several channels, only the channel stream
 * matching the edited event is renamed; the other channel streams stay intact.
 */
export function buildRecurringSeriesScheduleUpdates(
  items: RecurringSeriesItem[],
  edit: RecurringSeriesEdit,
): RecurringSeriesScheduleUpdate[] {
  const anchor = dateKeyAsUtc(edit.anchorDate)
  const next = dateKeyAsUtc(edit.nextDate)
  if (!anchor || !next) return []
  const dayOffset = Math.round((next.getTime() - anchor.getTime()) / 86_400_000)

  return items.map(item => {
    const shifted = dateKeyAsUtc(item.date)
    if (!shifted) {
      return {
        id: item.id,
        date: item.date,
        day_label: '',
        channel: item.channel,
      }
    }
    shifted.setUTCDate(shifted.getUTCDate() + dayOffset)
    return {
      id: item.id,
      date: utcDateKey(shifted),
      day_label: DAY_LABELS[shifted.getUTCDay()],
      channel: item.channel === edit.anchorChannel ? edit.nextChannel : item.channel,
    }
  })
}

interface ImportedCalendarItem {
  source_sheet?: string | null
  day_label: string
  content: string
}

/**
 * The source spreadsheet used "wk" as a weekend filler in every channel
 * column. Those rows are layout artifacts, not marketing events.
 */
export function isImportedWeekendPlaceholder(item: ImportedCalendarItem) {
  return Boolean(item.source_sheet)
    && ['SAT', 'SUN'].includes(item.day_label.toUpperCase())
    && item.content.trim().toLowerCase() === 'wk'
}
