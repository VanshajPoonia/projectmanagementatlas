import { describe, it, expect } from 'vitest'
import { getWorkNext, scoreTask } from './work-next'

// One company, one clock. Every instant here is explicit UTC with its business-zone time in a
// comment, and every due date is a bare `YYYY-MM-DD` - the shape a Postgres DATE column really
// arrives in. Both choices are deliberate: fixtures built from `toISOString()` round-trip through
// broken date maths unharmed, which is exactly how the bug at the bottom of this file survived.
const NOW = new Date('2026-08-27T15:00:00Z') // 10:00 America/Chicago, Thursday 27 August 2026
const LATE = new Date('2026-08-28T02:00:00Z') // 21:00 America/Chicago, SAME business day

function task(over: Record<string, unknown> = {}) {
  return { id: Math.random().toString(36).slice(2), title: 'T', status: 'todo', ...over }
}

describe('scoreTask - urgency', () => {
  it('ranks overdue above due-today above due-later', () => {
    const overdue = scoreTask(task({ due_date: '2026-08-25' }), NOW).score
    const today = scoreTask(task({ due_date: '2026-08-27' }), NOW).score
    const soon = scoreTask(task({ due_date: '2026-08-29' }), NOW).score
    const later = scoreTask(task({ due_date: '2026-12-01' }), NOW).score
    expect(overdue).toBeGreaterThan(today)
    expect(today).toBeGreaterThan(soon)
    expect(soon).toBeGreaterThan(later)
  })

  it('caps how far one ancient task can climb, so it cannot own the top forever', () => {
    const oldTask = scoreTask(task({ due_date: '2026-01-01' }), NOW).score
    const ancient = scoreTask(task({ due_date: '2020-01-01' }), NOW).score
    expect(ancient).toBe(oldTask)
  })

  it('gives undated work no urgency at all rather than treating it as urgent', () => {
    const undated = scoreTask(task({ due_date: null }), NOW)
    expect(undated.reasons).toContain('No due date')
    expect(undated.isOverdue).toBe(false)
  })
})

describe('scoreTask - reasons match the score', () => {
  // Prompt F's requirement: the deterministic signals behind a ranking stay visible, and an
  // unexplained number is not acceptable. A reason the score does not support breaks that just
  // as badly as showing no reason at all.
  it('does not claim a priority the score did not use', () => {
    // `priority: null` is what PostgREST returns for an unset priority, and it is the common
    // case. It must score as the middle of the scale AND say nothing about priority.
    const unset = scoreTask(task({ due_date: '2026-08-30', priority: null }), NOW)
    const medium = scoreTask(task({ due_date: '2026-08-30', priority: 3 }), NOW)
    expect(unset.score).toBe(medium.score)
    expect(unset.reasons).not.toContain('High priority')
    expect(unset.reasons).toEqual(medium.reasons)
  })

  it('says "Highest priority" only for 1 and "High priority" only for 2', () => {
    expect(scoreTask(task({ priority: 1 }), NOW).reasons).toContain('Highest priority')
    expect(scoreTask(task({ priority: 2 }), NOW).reasons).toContain('High priority')
    for (const p of [3, 4, 5]) {
      const reasons = scoreTask(task({ priority: p }), NOW).reasons
      expect(reasons).not.toContain('High priority')
      expect(reasons).not.toContain('Highest priority')
    }
  })

  it('scores a higher priority above a lower one, all else equal', () => {
    const scores = [1, 2, 3, 4, 5].map((p) => scoreTask(task({ due_date: '2026-08-30', priority: p }), NOW).score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('credits work already started, and says so', () => {
    const started = scoreTask(task({ due_date: '2026-08-30', status: 'in_progress' }), NOW)
    const notStarted = scoreTask(task({ due_date: '2026-08-30', status: 'todo' }), NOW)
    expect(started.score).toBeGreaterThan(notStarted.score)
    expect(started.reasons).toContain('Already in progress')
  })

  it('leads with the due-date reason, because that is the decision-relevant one', () => {
    const item = scoreTask(task({ due_date: '2026-08-27', priority: 1, status: 'in_progress' }), NOW)
    expect(item.reasons[0]).toBe('Due today')
  })

  it('counts overdue days in the singular and the plural', () => {
    expect(scoreTask(task({ due_date: '2026-08-26' }), NOW).reasons).toContain('1 day overdue')
    expect(scoreTask(task({ due_date: '2026-08-24' }), NOW).reasons).toContain('3 days overdue')
  })
})

describe('getWorkNext', () => {
  it('drops completed and soft-deleted work', () => {
    const items = getWorkNext(
      [
        task({ id: 'open', due_date: '2026-08-27' }),
        task({ id: 'done', due_date: '2026-08-27', status: 'done' }),
        task({ id: 'gone', due_date: '2026-08-27', deleted_at: '2026-08-01' }),
      ],
      5,
      NOW,
    )
    expect(items.map((i) => i.task.id)).toEqual(['open'])
  })

  it('honours the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => task({ due_date: '2026-08-27', title: `T${i}` }))
    expect(getWorkNext(many, 5, NOW)).toHaveLength(5)
  })

  it('breaks ties by due date, then by priority, so the order is stable', () => {
    // Same score by construction; the earlier due date must come first.
    const a = task({ id: 'later', due_date: '2026-09-10', priority: 3 })
    const b = task({ id: 'earlier', due_date: '2026-09-08', priority: 3 })
    expect(getWorkNext([a, b], 5, NOW).map((i) => i.task.id)).toEqual(['earlier', 'later'])
    expect(getWorkNext([b, a], 5, NOW).map((i) => i.task.id)).toEqual(['earlier', 'later'])
  })

  it('sorts undated work after dated work at the same score rather than before it', () => {
    const dated = task({ id: 'dated', due_date: '2026-12-01', priority: 1 })
    const undated = task({ id: 'undated', due_date: null, priority: 1 })
    const order = getWorkNext([undated, dated], 5, NOW).map((i) => i.task.id)
    expect(order.indexOf('dated')).toBeLessThan(order.indexOf('undated'))
  })

  it('survives empty and nullish input rather than throwing', () => {
    expect(getWorkNext([], 5, NOW)).toEqual([])
    expect(getWorkNext(null as any, 5, NOW)).toEqual([])
  })
})

describe('the timezone bug this replaced', () => {
  // `due_date` is a Postgres DATE and arrives as a bare `YYYY-MM-DD`. The old code parsed that
  // with `new Date()` - UTC midnight - and then zeroed it with LOCAL `setHours(0,0,0,0)`, which
  // in any negative UTC offset lands on the previous day. Measured in America/Chicago: work due
  // today was scored as overdue, painted red, and labelled "1 day overdue", all day, every day.
  //
  // These assertions must hold whatever timezone the test machine sits in.
  it('does not score today\'s work as overdue', () => {
    const item = scoreTask(task({ due_date: '2026-08-27' }), NOW)
    expect(item.isOverdue).toBe(false)
    expect(item.reasons).toContain('Due today')
    expect(item.reasons).not.toContain('1 day overdue')
  })

  it('does not describe tomorrow as today', () => {
    expect(scoreTask(task({ due_date: '2026-08-28' }), NOW).reasons).toContain('Due tomorrow')
  })

  it('gives the same answer at either instant on the same business day', () => {
    for (const instant of [NOW, LATE]) {
      expect(scoreTask(task({ due_date: '2026-08-27' }), instant).reasons).toContain('Due today')
      expect(scoreTask(task({ due_date: '2026-08-26' }), instant).isOverdue).toBe(true)
    }
  })

  it('ranks genuinely-overdue work above today\'s work, which the shift used to blur', () => {
    const items = getWorkNext(
      [task({ id: 'today', due_date: '2026-08-27' }), task({ id: 'late', due_date: '2026-08-24' })],
      5,
      NOW,
    )
    expect(items.map((i) => i.task.id)).toEqual(['late', 'today'])
    expect(items[1].isOverdue).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------
// Prompt F: the signals that come from outside the task row.
// ---------------------------------------------------------------------------------------

describe('blocked, blocking and approval signals', () => {
  const dueToday = { id: 'x', title: 'X', status: 'todo', due_date: '2026-08-27' }

  it('changes nothing at all when a caller supplies no signals', () => {
    // Backwards compatibility is the point: every existing caller keeps its old ranking.
    expect(scoreTask(dueToday, NOW).score).toBe(scoreTask(dueToday, NOW, {}).score)
    expect(scoreTask(dueToday, NOW).isBlocked).toBe(false)
  })

  it('sinks blocked work, and says so', () => {
    const blocked = scoreTask(dueToday, NOW, { blockedBy: 2 })
    expect(blocked.score).toBeLessThan(scoreTask(dueToday, NOW).score)
    expect(blocked.reasons[0]).toBe('Blocked by 2 items')
    expect(blocked.isBlocked).toBe(true)
  })

  it('says "1 item" rather than "1 items"', () => {
    expect(scoreTask(dueToday, NOW, { blockedBy: 1 }).reasons).toContain('Blocked by 1 item')
    expect(scoreTask(dueToday, NOW, { blocking: 1 }).reasons).toContain('Blocks 1 other item')
  })

  it('lifts work other people are stuck behind, and says so', () => {
    const blocking = scoreTask(dueToday, NOW, { blocking: 3 })
    expect(blocking.score).toBeGreaterThan(scoreTask(dueToday, NOW).score)
    expect(blocking.reasons).toContain('Blocks 3 other items')
  })

  it('sinks work parked on an approval, and says so', () => {
    const waiting = scoreTask(dueToday, NOW, { awaitingApproval: true })
    expect(waiting.score).toBeLessThan(scoreTask(dueToday, NOW).score)
    expect(waiting.reasons).toContain('Waiting on approval')
    expect(waiting.isBlocked).toBe(true)
  })

  it('never hides overdue blocked work entirely - the next action is to unblock it', () => {
    // The penalty is deliberately not large enough to push badly-late blocked work off the
    // list. Somebody still has to go and clear the blocker.
    const overdue = { id: 'o', title: 'O', status: 'todo', due_date: '2026-08-01' }
    const undated = { id: 'u', title: 'U', status: 'todo' }
    const ranked = getWorkNext([overdue, undated], 5, NOW, (t) => (t.id === 'o' ? { blockedBy: 1 } : {}))
    expect(ranked[0].task.id).toBe('o')
  })

  it('reads the reason from the same numbers as the score', () => {
    // The one bug this module has already shipped was a reason computed from a different
    // expression than the score. Garbage in a signal must not produce a reason.
    const noisy = scoreTask(dueToday, NOW, { blockedBy: -3 as any, blocking: Number.NaN as any })
    expect(noisy.score).toBe(scoreTask(dueToday, NOW).score)
    expect(noisy.reasons.join(' ')).not.toContain('Blocked by')
    expect(noisy.reasons.join(' ')).not.toContain('Blocks')
  })

  it('reports blocked before the due date, because a blocker decides whether and a date only when', () => {
    const reasons = scoreTask(dueToday, NOW, { blockedBy: 1, awaitingApproval: true }).reasons
    expect(reasons.slice(0, 2)).toEqual(['Blocked by 1 item', 'Waiting on approval'])
    expect(reasons.indexOf('Due today')).toBeGreaterThan(1)
  })

  it('passes each task its own signals, never the first task’s', () => {
    const a = { id: 'a', title: 'A', status: 'todo', due_date: '2026-08-27' }
    const b = { id: 'b', title: 'B', status: 'todo', due_date: '2026-08-27' }
    const ranked = getWorkNext([a, b], 5, NOW, (t) => (t.id === 'a' ? { blockedBy: 1 } : { blocking: 1 }))
    expect(ranked[0].task.id).toBe('b')
    expect(ranked[1].reasons).toContain('Blocked by 1 item')
  })
})
