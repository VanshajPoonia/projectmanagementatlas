import { describe, expect, it } from 'vitest'
import { cleanBoardDescription, cleanTaskDescription } from './display-text'

// The two constants this module used to hardcode. Every case below that quotes
// them is a regression guard: generalizing the matcher must not change what the
// original importer's output renders as.
const ORIGINAL_SOURCE = 'Source: Marketing Project Management.xlsx'
const ORIGINAL_BOARD = 'Imported from Marketing Project Management.xlsx'

describe('cleanTaskDescription', () => {
  it('returns nothing for empty input', () => {
    expect(cleanTaskDescription(null)).toBe('')
    expect(cleanTaskDescription(undefined)).toBe('')
    expect(cleanTaskDescription('   ')).toBe('')
  })

  it('leaves an ordinary description untouched', () => {
    expect(cleanTaskDescription('  Ship the Q3 campaign  ')).toBe('Ship the Q3 campaign')
  })

  it('drops the original importer header entirely when there are no notes', () => {
    expect(cleanTaskDescription(`${ORIGINAL_SOURCE}\nRow 14`)).toBe('')
  })

  it('keeps what a human typed under the notes heading', () => {
    expect(cleanTaskDescription(
      `${ORIGINAL_SOURCE}\nRow 14\nNotes & Status: Waiting on legal review`,
    )).toBe('Waiting on legal review')
  })

  // The point of the change: a second import under a different filename used to
  // show its boilerplate to every user with no way to hide it.
  it('strips the header for any spreadsheet, not just the one that was hardcoded', () => {
    expect(cleanTaskDescription('Source: Q4 Planning.xlsx\nRow 2')).toBe('')
    expect(cleanTaskDescription('Source: budget.csv\nNotes & Status: Approved')).toBe('Approved')
    expect(cleanTaskDescription('source: legacy.xls\nRow 9')).toBe('')
  })

  it('only considers the first line, so a body that mentions a file is kept', () => {
    const text = 'Reconcile the numbers\nSource: Marketing Project Management.xlsx'
    expect(cleanTaskDescription(text)).toBe(text)
  })

  it('leaves a description alone when the leading line names no spreadsheet', () => {
    expect(cleanTaskDescription('Source: the client call on Tuesday')).toBe('Source: the client call on Tuesday')
  })
})

describe('cleanBoardDescription', () => {
  it('returns nothing for empty input', () => {
    expect(cleanBoardDescription(null)).toBe('')
    expect(cleanBoardDescription('  ')).toBe('')
  })

  it('leaves an ordinary description untouched', () => {
    expect(cleanBoardDescription(' Marketing planning ')).toBe('Marketing planning')
  })

  it('drops the original importer header', () => {
    expect(cleanBoardDescription(`${ORIGINAL_BOARD} on 12 March`)).toBe('')
  })

  it('drops the header for any spreadsheet, not just the one that was hardcoded', () => {
    expect(cleanBoardDescription('Imported from Q4 Planning.xlsx')).toBe('')
    expect(cleanBoardDescription('imported from legacy.csv on 2 June')).toBe('')
  })

  it('only considers the first line', () => {
    const text = 'Campaign board\nImported from Marketing Project Management.xlsx'
    expect(cleanBoardDescription(text)).toBe(text)
  })
})
