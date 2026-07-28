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

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function dateKeyAsUtc(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function utcDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
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
  const dayOffset = Math.round((next.getTime() - anchor.getTime()) / 86_400_000)

  return items.map(item => {
    const shifted = dateKeyAsUtc(item.date)
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
