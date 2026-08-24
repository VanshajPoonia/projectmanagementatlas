// Multi-create: paste a list, get tasks. Every line goes through the same quick-capture parser,
// so one pasted line behaves exactly as it would typed into the capture box.
//
// TWO RULES SHAPE THIS FILE.
//
// 1. "Do not infer hierarchy silently when indentation is ambiguous" (Prompt D). Pasted text
//    carries indentation from wherever it was copied - a Word bullet list, a Slack message, a
//    spreadsheet cell - and that indentation is frequently meaningless. So indentation is
//    ANALYSED here and REPORTED, never acted on by default. `hierarchy` says what was found and
//    how confident it is; the dialog offers a checkbox and shows the resulting shape before
//    anything is written. A silent guess produces subtasks under the wrong parent, which is
//    tedious to undo one card at a time.
//
// 2. Only one level of nesting exists in this product. Migration 060's
//    enforce_single_level_subtasks trigger refuses a subtask of a subtask outright, so a
//    three-level paste is not something this can create however it is asked. That is reported
//    as a flattening, with the count, rather than discovered as a database error halfway
//    through a batch.

import { parseQuickCapture, type ParsedCapture, type ParseOptions } from './quick-capture'

export interface MultiCreateItem {
  /** The line exactly as pasted, indentation included. */
  raw: string
  /** 1-based, so a warning can name the line the user is looking at. */
  lineNumber: number
  /** Indentation columns, tabs counted as 4. Raw measurement, not a decision. */
  indent: number
  /** 0 = top level, 1 = subtask. Only ever 0 or 1; see the header. */
  depth: number
  /** Index into `items` of this item's parent, or null. */
  parentIndex: number | null
  parsed: ParsedCapture
  /** True when another line in this paste has the same title. */
  duplicateOf: number | null
}

export type HierarchyConfidence = 'none' | 'clear' | 'ambiguous'

export interface MultiCreatePlan {
  items: MultiCreateItem[]
  hierarchy: {
    confidence: HierarchyConfidence
    /** Why it is ambiguous, or how it was read when clear. Always shown to the user. */
    reason: string
    /** Lines deeper than one level, which 060 cannot store. */
    flattened: number
  }
  warnings: string[]
  /** Lines that were dropped for being blank or bullet-only, so the count adds up. */
  skipped: number
}

/** Leading whitespace width, tabs as 4 columns. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)![0]
  let width = 0
  for (const ch of lead) width += ch === '\t' ? 4 : 1
  return width
}

/**
 * Strip a leading bullet or numbering so "- Call client" and "1. Call client" both work.
 *
 * The `(?:\s+|$)` tail matters: without it a line holding nothing but "-" fails to match and
 * becomes a task titled "-". A bullet with no text after it is punctuation, not work.
 */
function stripBullet(line: string): string {
  return line.replace(/^[ \t]*(?:[-*•‣◦]|\d{1,3}[.)])(?:\s+|$)/, '').trim()
}

export function parseMultiCreate(text: string, options: ParseOptions = {}): MultiCreatePlan {
  const warnings: string[] = []
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')

  const kept: { raw: string; lineNumber: number; indent: number; content: string }[] = []
  let skipped = 0

  rawLines.forEach((raw, i) => {
    const content = stripBullet(raw)
    if (!content) {
      if (raw.trim()) skipped++ // a bullet with no text after it
      return
    }
    kept.push({ raw, lineNumber: i + 1, indent: indentOf(raw), content })
  })

  if (kept.length === 0) {
    return { items: [], hierarchy: { confidence: 'none', reason: 'Nothing to create yet.', flattened: 0 }, warnings, skipped }
  }

  // --- read the indentation, decide nothing yet ------------------------------------------
  const indents = [...new Set(kept.map((k) => k.indent))].sort((a, b) => a - b)
  const usesTabs = kept.some((k) => /^\s*\t/.test(k.raw))
  const usesSpaces = kept.some((k) => /^ /.test(k.raw))

  let confidence: HierarchyConfidence = 'none'
  let reason = 'Every line is at the same level, so all of these will be top-level tasks.'

  if (indents.length > 1) {
    if (usesTabs && usesSpaces) {
      confidence = 'ambiguous'
      reason = 'This paste mixes tabs and spaces, so the nesting cannot be read reliably. Check the preview before turning it on.'
    } else if (kept[0].indent > indents[0]) {
      confidence = 'ambiguous'
      reason = 'The first line is indented further than a later one, so there is no clear parent to nest under.'
    } else if (indents.length > 3) {
      confidence = 'ambiguous'
      reason = `This paste has ${indents.length} different indent widths, which usually means the spacing came along with the copy rather than meaning anything.`
    } else {
      confidence = 'clear'
      reason = 'Indented lines will become subtasks of the line above them.'
    }
  }

  // --- build the items -------------------------------------------------------------------
  const items: MultiCreateItem[] = []
  let lastTopLevel: number | null = null
  let flattened = 0

  kept.forEach((k) => {
    // Level by position in the sorted indent list, then clamped: 060 stores one level only.
    const rawDepth = indents.indexOf(k.indent)
    let depth = rawDepth
    if (depth > 1) {
      depth = 1
      flattened++
    }

    // A subtask with no preceding top-level line has nothing to hang from.
    if (depth === 1 && lastTopLevel === null) {
      depth = 0
      warnings.push(`Line ${k.lineNumber} is indented but has no task above it to belong to, so it becomes a top-level task.`)
    }

    const parsed = parseQuickCapture(k.content, options)
    const index = items.length

    items.push({
      raw: k.raw,
      lineNumber: k.lineNumber,
      indent: k.indent,
      depth,
      parentIndex: depth === 1 ? lastTopLevel : null,
      parsed,
      duplicateOf: null,
    })

    if (depth === 0) lastTopLevel = index
  })

  // --- duplicate detection ---------------------------------------------------------------
  // Within the paste only. Warned about, never blocked: two genuinely identical tasks on
  // different dates are ordinary, and refusing them would be the parser overruling the user.
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const key = item.parsed.title.trim().toLowerCase()
    if (!key) return
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, i)
      return
    }
    item.duplicateOf = first
  })
  const dupes = items.filter((i) => i.duplicateOf !== null).length
  if (dupes > 0) {
    warnings.push(`${dupes} line${dupes === 1 ? '' : 's'} repeat${dupes === 1 ? 's' : ''} a title already in this list. They will all be created unless you remove them.`)
  }

  if (flattened > 0) {
    warnings.push(`${flattened} line${flattened === 1 ? '' : 's'} nested more than one level deep. This product stores one level of subtasks, so they become subtasks of the nearest task above.`)
  }

  const untitled = items.filter((i) => !i.parsed.title.trim()).length
  if (untitled > 0) {
    warnings.push(`${untitled} line${untitled === 1 ? '' : 's'} would have no title left after parsing. Give ${untitled === 1 ? 'it' : 'them'} some words, or remove ${untitled === 1 ? 'it' : 'them'}.`)
  }

  return { items, hierarchy: { confidence, reason, flattened }, warnings, skipped }
}

/** How many tasks a plan would create, honouring the user's hierarchy choice. */
export function summarizePlan(plan: MultiCreatePlan, useHierarchy: boolean): {
  total: number
  topLevel: number
  subtasks: number
} {
  const creatable = plan.items.filter((i) => i.parsed.title.trim())
  if (!useHierarchy) {
    return { total: creatable.length, topLevel: creatable.length, subtasks: 0 }
  }
  const subtasks = creatable.filter((i) => i.depth === 1 && i.parentIndex !== null).length
  return { total: creatable.length, topLevel: creatable.length - subtasks, subtasks }
}
