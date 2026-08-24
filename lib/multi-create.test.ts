import { describe, it, expect } from 'vitest'
import { parseMultiCreate, summarizePlan } from './multi-create'

const TODAY = '2026-08-24'
const parse = (text: string, opts = {}) => parseMultiCreate(text, { today: TODAY, ...opts })

describe("Prompt D's worked examples", () => {
  it('turns a flat paste into one task per line', () => {
    const plan = parse('Prepare proposal\nCall client\nSend estimate')
    expect(plan.items).toHaveLength(3)
    expect(plan.items.map((i) => i.parsed.title)).toEqual(['Prepare proposal', 'Call client', 'Send estimate'])
    expect(plan.items.every((i) => i.depth === 0)).toBe(true)
    expect(plan.hierarchy.confidence).toBe('none')
  })

  it('reads an indented paste as parent and child', () => {
    const plan = parse('Launch campaign\n  Draft Facebook post\n  Draft Instagram post')
    expect(plan.hierarchy.confidence).toBe('clear')
    expect(plan.items.map((i) => i.depth)).toEqual([0, 1, 1])
    expect(plan.items[1].parentIndex).toBe(0)
    expect(plan.items[2].parentIndex).toBe(0)
  })

  it('attaches each child to the nearest task above it', () => {
    const plan = parse('Campaign A\n  Post one\nCampaign B\n  Post two')
    expect(plan.items.map((i) => i.parentIndex)).toEqual([null, 0, null, 2])
  })
})

describe('does not infer hierarchy silently when indentation is ambiguous', () => {
  it('flags a paste that mixes tabs and spaces', () => {
    const plan = parse('Parent\n\tChild by tab\n  Child by spaces')
    expect(plan.hierarchy.confidence).toBe('ambiguous')
    expect(plan.hierarchy.reason).toMatch(/mixes tabs and spaces/)
  })

  it('flags a paste whose first line is indented deeper than a later one', () => {
    const plan = parse('    Floating first line\nTop level\n')
    expect(plan.hierarchy.confidence).toBe('ambiguous')
    expect(plan.hierarchy.reason).toMatch(/no clear parent/)
  })

  it('flags a paste with many different indent widths as probably accidental', () => {
    const plan = parse('A\n  B\n     C\n       D\n         E')
    expect(plan.hierarchy.confidence).toBe('ambiguous')
    expect(plan.hierarchy.reason).toMatch(/came along with the copy/)
  })

  it('still returns every line when the nesting is ambiguous, losing nothing', () => {
    const plan = parse('Parent\n\tChild by tab\n  Child by spaces')
    expect(plan.items).toHaveLength(3)
    expect(plan.items.map((i) => i.parsed.title)).toEqual(['Parent', 'Child by tab', 'Child by spaces'])
  })

  it('says plainly when there is no nesting at all', () => {
    expect(parse('One\nTwo').hierarchy.reason).toMatch(/same level/)
  })
})

describe("respects 060's single-level subtask rule", () => {
  it('flattens a third level rather than trying to create it', () => {
    const plan = parse('Epic\n  Story\n    Task')
    expect(plan.items.map((i) => i.depth)).toEqual([0, 1, 1])
    expect(plan.hierarchy.flattened).toBe(1)
    expect(plan.warnings.join(' ')).toMatch(/one level of subtasks/)
  })

  it('never produces a depth above 1, however deep the paste goes', () => {
    const plan = parse('A\n  B\n    C\n      D\n        E\n          F')
    expect(Math.max(...plan.items.map((i) => i.depth))).toBe(1)
  })

  it('never points a subtask at another subtask', () => {
    const plan = parse('A\n  B\n    C')
    for (const item of plan.items) {
      if (item.parentIndex !== null) {
        expect(plan.items[item.parentIndex].depth).toBe(0)
      }
    }
  })

  it('promotes a leading indented line rather than orphaning it', () => {
    const plan = parse('  Orphan\nParent\n  Child')
    expect(plan.items[0].depth).toBe(0)
    expect(plan.warnings.join(' ')).toMatch(/no task above it/)
  })
})

describe('line cleanup', () => {
  it('strips bullet characters', () => {
    const plan = parse('- Call client\n* Send estimate\n• Follow up')
    expect(plan.items.map((i) => i.parsed.title)).toEqual(['Call client', 'Send estimate', 'Follow up'])
  })

  it('strips numbered list markers', () => {
    const plan = parse('1. First\n2) Second\n10. Tenth')
    expect(plan.items.map((i) => i.parsed.title)).toEqual(['First', 'Second', 'Tenth'])
  })

  it('does not strip a number that is part of the task', () => {
    expect(parse('Order 24 hinges').items[0].parsed.title).toBe('Order 24 hinges')
  })

  it('drops blank lines without counting them as skipped', () => {
    const plan = parse('One\n\n\nTwo\n   \n')
    expect(plan.items).toHaveLength(2)
    expect(plan.skipped).toBe(0)
  })

  it('counts a bullet with no text as skipped, so the numbers add up', () => {
    const plan = parse('One\n-\nTwo')
    expect(plan.items).toHaveLength(2)
    expect(plan.skipped).toBe(1)
  })

  it('handles Windows line endings', () => {
    expect(parse('One\r\nTwo\r\n').items).toHaveLength(2)
  })

  it('reports the original line number, not the kept-item index', () => {
    const plan = parse('\n\nReal task')
    expect(plan.items[0].lineNumber).toBe(3)
  })
})

describe('quick-capture syntax works per line', () => {
  it('parses fields out of each pasted line independently', () => {
    const plan = parse('Prepare proposal tomorrow p1\nCall client friday\nSend estimate')
    expect(plan.items[0].parsed.dueDate).toBe('2026-08-25')
    expect(plan.items[0].parsed.priority).toBe(1)
    expect(plan.items[1].parsed.dueDate).toBe('2026-08-28')
    expect(plan.items[2].parsed.dueDate).toBeNull()
  })

  it('resolves assignees per line', () => {
    const people = [{ id: 'u1', name: 'Bobby Shanks' }]
    const plan = parse('Task one @Bobby\nTask two', { people })
    expect(plan.items[0].parsed.assignees).toEqual(['u1'])
    expect(plan.items[1].parsed.assignees).toEqual([])
  })

  it('parses a subtask line the same way as a parent line', () => {
    const plan = parse('Launch\n  Draft post tomorrow p2')
    expect(plan.items[1].parsed.dueDate).toBe('2026-08-25')
    expect(plan.items[1].parsed.priority).toBe(2)
    expect(plan.items[1].parsed.title).toBe('Draft post')
  })
})

describe('duplicate detection', () => {
  it('flags a repeated title without refusing it', () => {
    const plan = parse('Call client\nSend estimate\nCall client')
    expect(plan.items[2].duplicateOf).toBe(0)
    expect(plan.items[0].duplicateOf).toBeNull()
    expect(plan.warnings.join(' ')).toMatch(/repeats a title/)
  })

  it('is case- and whitespace-insensitive', () => {
    const plan = parse('Call client\n  CALL CLIENT  ')
    expect(plan.items[1].duplicateOf).toBe(0)
  })

  it('compares the parsed title, not the raw line', () => {
    // Same work, different day: the titles match once the dates are parsed out.
    const plan = parse('Site walkthrough monday\nSite walkthrough friday')
    expect(plan.items[1].duplicateOf).toBe(0)
  })

  it('does not flag genuinely different titles', () => {
    const plan = parse('Call client\nCall supplier')
    expect(plan.items.every((i) => i.duplicateOf === null)).toBe(true)
  })
})

describe('untitled lines', () => {
  it('warns about a line that parses away to nothing', () => {
    const plan = parse('Real task\ntomorrow')
    expect(plan.items[1].parsed.title).toBe('')
    expect(plan.warnings.join(' ')).toMatch(/no title left/)
  })
})

describe('summarizePlan', () => {
  const plan = parse('Launch campaign\n  Draft post\n  Schedule post\nSecond campaign')

  it('counts subtasks when hierarchy is on', () => {
    expect(summarizePlan(plan, true)).toEqual({ total: 4, topLevel: 2, subtasks: 2 })
  })

  it('counts everything as top level when hierarchy is off', () => {
    expect(summarizePlan(plan, false)).toEqual({ total: 4, topLevel: 4, subtasks: 0 })
  })

  it('excludes lines that would have no title', () => {
    expect(summarizePlan(parse('Real one\ntomorrow'), false).total).toBe(1)
  })
})

describe('empty input', () => {
  it('returns an empty plan rather than throwing', () => {
    const plan = parse('')
    expect(plan.items).toEqual([])
    expect(plan.hierarchy.confidence).toBe('none')
  })

  it('returns an empty plan for whitespace only', () => {
    expect(parse('   \n\t\n  ').items).toEqual([])
  })
})
