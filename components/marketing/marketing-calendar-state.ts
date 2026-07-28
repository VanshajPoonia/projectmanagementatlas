/**
 * An empty selection is the single canonical representation of "All".
 * Keeping both [] and every company id as "All" made a company click invert
 * the filter after the All button had been used.
 */
export function toggleCompanySelection(
  activeCompanyIds: string[],
  companyId: string,
  allCompanyIds: string[],
) {
  if (activeCompanyIds.length === 0) return [companyId]

  const next = activeCompanyIds.includes(companyId)
    ? activeCompanyIds.filter(id => id !== companyId)
    : [...activeCompanyIds, companyId]

  if (next.length === 0 || allCompanyIds.every(id => next.includes(id))) return []
  return next
}

export function reconcileCompanySelection(
  activeCompanyIds: string[],
  availableCompanyIds: string[],
) {
  if (activeCompanyIds.length === 0) return []

  const next = activeCompanyIds.filter(id => availableCompanyIds.includes(id))
  if (next.length === 0 || availableCompanyIds.every(id => next.includes(id))) return []
  return next
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
