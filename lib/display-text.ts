// Strips the boilerplate the spreadsheet importer prepends to descriptions, so the
// UI shows what someone actually wrote rather than where the row came from.
//
// These used to name one file literally ('Marketing Project Management.xlsx'), which
// meant a second import under any other filename would have shown its own boilerplate
// to every user with no way to hide it. The match is now on the shape the importer
// writes - a leading `Source:` / `Imported from` line naming a spreadsheet - which
// covers the original file and any future one. Every string the old constants
// matched is still matched, so no existing description can start rendering differently.
//
// Anchored with ^ and using [^\n]* so only the first line is considered: a description
// whose *body* happens to mention a spreadsheet is left alone.
const SPREADSHEET = String.raw`[^\n]*\.(?:xlsx|xlsm|xls|csv)`
const IMPORT_SOURCE_LINE = new RegExp(String.raw`^Source:\s+${SPREADSHEET}`, 'i')
const IMPORT_BOARD_LINE = new RegExp(String.raw`^Imported from\s+${SPREADSHEET}`, 'i')

export function cleanBoardDescription(description?: string | null) {
  const text = description?.trim()
  if (!text || IMPORT_BOARD_LINE.test(text)) return ''
  return text
}

export function cleanTaskDescription(description?: string | null) {
  const text = description?.trim()
  if (!text) return ''
  if (!IMPORT_SOURCE_LINE.test(text)) return text

  // The importer buries anything a human typed under a "Notes & Status:" heading.
  // That part is worth keeping; the provenance header above it is not.
  const notes = text.match(/(?:^|\n)Notes & Status:\s*([\s\S]*)$/)?.[1]?.trim()
  return notes || ''
}
