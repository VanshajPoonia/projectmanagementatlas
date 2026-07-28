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
