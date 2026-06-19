const IMPORT_SOURCE_PREFIX = 'Source: Marketing Project Management.xlsx'
const IMPORT_BOARD_PREFIX = 'Imported from Marketing Project Management.xlsx'

export function cleanBoardDescription(description?: string | null) {
  const text = description?.trim()
  if (!text || text.startsWith(IMPORT_BOARD_PREFIX)) return ''
  return text
}

export function cleanTaskDescription(description?: string | null) {
  const text = description?.trim()
  if (!text) return ''
  if (!text.startsWith(IMPORT_SOURCE_PREFIX)) return text

  const notes = text.match(/(?:^|\n)Notes & Status:\s*([\s\S]*)$/)?.[1]?.trim()
  return notes || ''
}
