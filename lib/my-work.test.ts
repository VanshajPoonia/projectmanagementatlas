import { describe, it, expect } from 'vitest'
import {
  UNANSWERED_QUESTIONS,
  buildMyWork,
  byDueDate,
  daysUntil,
  isOpen,
  myWorkSummary,
} from './my-work'
import { addDays } from './calendar-grid'

// One company, one clock. Every date on this page is a CALENDAR DATE in BUSINESS_TIME_ZONE
// (America/Chicago), never an instant in whatever zone the reader happens to sit in.
//
// ⚠️ This block used to say the opposite - "local time on purpose ... fixtures built from `Z`
// instants would make these assertions depend on the machine's timezone" - and building the
// fixtures from `toISOString()` is precisely what hid a live bug. `due_date` is a Postgres DATE
// and arrives as a bare `YYYY-MM-DD`; a full timestamp round-trips through the old local-midnight
// maths unharmed, so every test passed while production was a day out. Fixtures are date-only
// now, matching what the column actually returns, and every assertion here has to hold under any
// machine timezone rather than only the one that wrote it.
const NOW = new Date('2026-08-13T17:00:00Z') // 12:00 America/Chicago, 13 August 2026
const ME = 'me'

/** A bare `YYYY-MM-DD` `days` from NOW's business date - exactly the shape PostgREST returns. */
function at(days: number): string {
  return addDays('2026-08-13', days)
}

function task(over: Record<string, unknown> = {}) {
  return { id: Math.random().toString(36).slice(2), title: 'T', created_by: ME, status: 'todo', ...over }
}

function section(result: ReturnType<typeof buildMyWork>, id: string) {
  return result.sections.find((s) => s.id === id)
}

describe('daysUntil', () => {
  // Compared at day granularity, not by timestamp: a task due today is still "due today"
  // at one minute past midnight and at one minute to it, business-zone time.
  it('measures whole calendar days, so any clock time within the day is 0', () => {
    expect(daysUntil('2026-08-13', new Date('2026-08-13T05:01:00Z'))).toBe(0) // 00:01 Chicago
    expect(daysUntil('2026-08-13', new Date('2026-08-14T04:59:00Z'))).toBe(0) // 23:59 Chicago
  })

  // ⚠️ `tasks.due_date` is TIMESTAMPTZ, not DATE, and it stores MIDNIGHT on the chosen day.
  // Both shapes the app writes must resolve to that day - re-zoning the instant into Chicago
  // moves the common one (UTC midnight) to the day before, which is the bug this replaced.
  it('reads the stored day for both shapes the app actually writes', () => {
    expect(daysUntil('2026-08-13T00:00:00+00:00', NOW)).toBe(0) // <input type="date">
    expect(daysUntil('2026-08-13T05:00:00+00:00', NOW)).toBe(0) // picker at Chicago midnight
    expect(daysUntil('2026-08-14T00:00:00+00:00', NOW)).toBe(1)
  })

  it('is negative for past dates and positive for future ones', () => {
    expect(daysUntil(at(-3), NOW)).toBe(-3)
    expect(daysUntil(at(5), NOW)).toBe(5)
  })

  it('returns null for missing or unparseable dates rather than throwing', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil(undefined, NOW)).toBeNull()
    expect(daysUntil('not a date', NOW)).toBeNull()
  })
})

describe('isOpen', () => {
  it('excludes completed and soft-deleted work', () => {
    expect(isOpen(task())).toBe(true)
    expect(isOpen(task({ status: 'done' }))).toBe(false)
    expect(isOpen(task({ deleted_at: at(-1) }))).toBe(false)
  })
})

describe('buildMyWork sections', () => {
  const overdue = task({ id: 'overdue', due_date: at(-2) })
  const dueToday = task({ id: 'today', due_date: at(0) })
  const thisWeek = task({ id: 'week', due_date: at(3) })
  const later = task({ id: 'later', due_date: at(30) })
  const undated = task({ id: 'undated' })
  const started = task({ id: 'started', status: 'in_progress', due_date: at(4) })
  const mine = [overdue, dueToday, thisWeek, later, undated, started]

  it('routes each task to its urgency section', () => {
    const result = buildMyWork(mine, mine, ME, NOW)
    expect(section(result, 'overdue')?.tasks.map((t) => t.id)).toEqual(['overdue'])
    expect(section(result, 'today')?.tasks.map((t) => t.id)).toEqual(['today'])
    expect(section(result, 'this-week')?.tasks.map((t) => t.id)).toEqual(['week', 'started'])
  })

  // A far-future or undated task is real work, but it is not urgent - it must not leak
  // into a section that the user reads as "act on this now".
  it('keeps far-future and undated work out of every urgency section', () => {
    const result = buildMyWork(mine, mine, ME, NOW)
    const urgent = ['overdue', 'today', 'this-week'].flatMap(
      (id) => section(result, id)?.tasks.map((t) => t.id) ?? [],
    )
    expect(urgent).not.toContain('later')
    expect(urgent).not.toContain('undated')
  })

  it('collects in-progress work regardless of when it is due', () => {
    const result = buildMyWork(mine, mine, ME, NOW)
    expect(section(result, 'in-progress')?.tasks.map((t) => t.id)).toEqual(['started'])
  })

  it('hides sections that have nothing in them', () => {
    const result = buildMyWork([task({ due_date: at(-1) })], [], ME, NOW)
    expect(result.sections.map((s) => s.id)).toEqual(['overdue'])
  })

  it('drops done and deleted work from every section', () => {
    const result = buildMyWork(
      [task({ status: 'done', due_date: at(-5) }), task({ deleted_at: at(-1), due_date: at(-5) })],
      [],
      ME,
      NOW,
    )
    expect(result.sections).toEqual([])
  })

  it('gives every rendered section an explanation, never a bare heading', () => {
    const result = buildMyWork(mine, mine, ME, NOW)
    for (const s of result.sections) expect(s.description.length).toBeGreaterThan(0)
  })
})

describe('the delegated section', () => {
  const handedOff = task({ id: 'handed-off', created_by: ME, due_date: at(2) })
  const someoneElses = task({ id: 'theirs', created_by: 'other', due_date: at(2) })
  const alsoMine = task({ id: 'both', created_by: ME, due_date: at(2) })

  it('lists work I created that someone else is carrying', () => {
    const result = buildMyWork([alsoMine], [handedOff, someoneElses, alsoMine], ME, NOW)
    expect(section(result, 'delegated')?.tasks.map((t) => t.id)).toEqual(['handed-off'])
  })

  // Work I created *and* still own belongs in my own urgency sections, not in a list
  // headed "waiting on someone else" - I am the someone else.
  it('excludes work I both created and still hold', () => {
    const result = buildMyWork([alsoMine], [alsoMine], ME, NOW)
    expect(section(result, 'delegated')).toBeUndefined()
  })

  it('never lists work created by someone else', () => {
    const result = buildMyWork([], [someoneElses], ME, NOW)
    expect(section(result, 'delegated')).toBeUndefined()
  })
})

describe('the ranked shortlist', () => {
  it('carries the reasons that put each item where it is', () => {
    const { next } = buildMyWork(
      [task({ id: 'urgent', due_date: at(-1), priority: 1 }), task({ id: 'calm', due_date: at(20) })],
      [],
      ME,
      NOW,
    )
    expect(next[0].task.id).toBe('urgent')
    expect(next[0].reasons.length).toBeGreaterThan(0)
  })

  it('never recommends completed work', () => {
    const { next } = buildMyWork([task({ status: 'done', due_date: at(-1) })], [], ME, NOW)
    expect(next).toEqual([])
  })
})

describe('byDueDate', () => {
  // Undated work sorting first is what a naive null-as-zero comparison produces, and it
  // would put the least urgent items at the top of every list.
  it('sorts earliest first and pushes undated work to the end', () => {
    const sorted = byDueDate([
      task({ id: 'none' }),
      task({ id: 'late', due_date: at(9) }),
      task({ id: 'soon', due_date: at(1) }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['soon', 'late', 'none'])
  })

  it('does not mutate its input', () => {
    const input = [task({ id: 'b', due_date: at(2) }), task({ id: 'a', due_date: at(1) })]
    byDueDate(input)
    expect(input.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('myWorkSummary', () => {
  it('counts open, overdue and due-today work', () => {
    const summary = myWorkSummary(
      [
        task({ due_date: at(-1) }),
        task({ due_date: at(0) }),
        task({ due_date: at(4) }),
        task({ status: 'done', due_date: at(-9) }),
      ],
      NOW,
    )
    expect(summary).toEqual({ open: 3, overdue: 1, dueToday: 1 })
  })

  it('handles an empty or missing list', () => {
    expect(myWorkSummary([], NOW)).toEqual({ open: 0, overdue: 0, dueToday: 0 })
  })
})

describe('unanswered questions', () => {
  // These are declared rather than approximated on purpose. If a future slice adds
  // dependencies or approvals, the corresponding entry should be removed here and a real
  // section added - this test is the reminder that the list is load-bearing.
  it('names each gap and what would close it', () => {
    expect(UNANSWERED_QUESTIONS.length).toBeGreaterThan(0)
    for (const entry of UNANSWERED_QUESTIONS) {
      expect(entry.question).toBeTruthy()
      expect(entry.blockedBy).toBeTruthy()
    }
  })
})

describe('the timezone bug this replaced', () => {
  // The old code parsed `due_date` with `new Date()` - which reads a bare YYYY-MM-DD as UTC
  // midnight - and then zeroed it with LOCAL `setHours(0,0,0,0)`. In any negative UTC offset
  // that lands on the previous day, so every date was a day early: measured in America/Chicago,
  // a task due today returned -1. The Overdue stat counted today's work as late and "Due today"
  // showed tomorrow's, all day, every day, for every user in the US.
  //
  // These assertions are the reason the module now goes through calendar dates. They must hold
  // whatever timezone the test machine is in, which is what the old fixtures could not express.
  const TEN_AM = new Date('2026-08-27T15:00:00Z') // 10:00 America/Chicago, 27 August
  const NINE_PM = new Date('2026-08-28T02:00:00Z') // 21:00 America/Chicago, SAME business day

  it('does not report a task due today as a day overdue', () => {
    expect(daysUntil('2026-08-27', TEN_AM)).toBe(0)
  })

  it('does not report tomorrow as due today', () => {
    expect(daysUntil('2026-08-28', TEN_AM)).toBe(1)
  })

  it('gives the same answer at either instant on the same business day', () => {
    for (const instant of [TEN_AM, NINE_PM]) {
      expect(daysUntil('2026-08-27', instant)).toBe(0)
      expect(daysUntil('2026-08-26', instant)).toBe(-1)
    }
  })

  it('keeps the headline counts honest: today is due-today, not overdue', () => {
    const mine = [
      { id: 'a', title: 'A', status: 'todo', due_date: '2026-08-27' },
      { id: 'b', title: 'B', status: 'todo', due_date: '2026-08-26' },
    ]
    expect(myWorkSummary(mine, TEN_AM)).toEqual({ open: 2, overdue: 1, dueToday: 1 })
  })

  it('files today\'s work under "Due today" rather than "Overdue"', () => {
    const mine = [{ id: 'a', title: 'A', created_by: ME, status: 'todo', due_date: '2026-08-27' }]
    const result = buildMyWork(mine, mine, ME, TEN_AM)
    expect(section(result, 'overdue')).toBeUndefined()
    expect(section(result, 'today')?.tasks.map((t) => t.id)).toEqual(['a'])
  })
})
