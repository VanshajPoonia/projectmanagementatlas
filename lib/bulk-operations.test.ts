import { describe, it, expect, vi } from 'vitest'
import {
  planBulkOperation,
  runBulkOperation,
  summarizeRun,
  bulkReportCsv,
  retryPlanFrom,
  mergeRunReports,
  ALL_OPERATIONS,
  OPERATION_LABELS,
  type BulkTask,
  type PermissionResolver,
  type ApplyResult,
} from './bulk-operations'

const ALLOW = { allowed: true, presentation: 'allow' as const }
const DENY = { allowed: false, presentation: 'explain' as const, reason: 'Guest access can open this board but not change its work.' }
const allowAll: PermissionResolver = () => ALLOW
const denyAll: PermissionResolver = () => DENY

const task = (over: Partial<BulkTask> = {}): BulkTask => ({
  id: 't1', title: 'A task', priority: 3, due_date: null,
  assigneeIds: [], tagIds: [], ...over,
})

// Zero waiting in tests; the retry timing is not what is being asserted.
const noDelay = () => Promise.resolve()

describe('planBulkOperation separates a real change from a no-op', () => {
  it('counts only the tasks whose priority would actually move', () => {
    const tasks = [task({ id: 'a', priority: 3 }), task({ id: 'b', priority: 1 }), task({ id: 'c', priority: 3 })]
    const plan = planBulkOperation({ kind: 'priority', priority: 3 }, tasks, allowAll)
    expect(plan.counts).toEqual({ willChange: 1, alreadyMatches: 2, notPermitted: 0, total: 3 })
  })

  it('shows before and after for a real change', () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task({ priority: 4 })], allowAll)
    expect(plan.items[0]).toMatchObject({ outcome: 'will_change', before: 'Low', after: 'Highest' })
  })

  it('flags a plan that would do nothing', () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 3 }, [task({ priority: 3 })], allowAll)
    expect(plan.isNoOp).toBe(true)
  })

  it('never loses a selected task from the accounting', () => {
    const tasks = [task({ id: 'a', priority: 3 }), task({ id: 'b', priority: 1 })]
    const plan = planBulkOperation({ kind: 'priority', priority: 3 }, tasks, allowAll)
    const { willChange, alreadyMatches, notPermitted, total } = plan.counts
    expect(willChange + alreadyMatches + notPermitted).toBe(total)
    expect(total).toBe(tasks.length)
  })
})

describe('planBulkOperation respects per-task permission', () => {
  it('marks a task the actor cannot change, with the reason', () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task()], denyAll)
    expect(plan.items[0].outcome).toBe('not_permitted')
    expect(plan.items[0].note).toMatch(/Guest access/)
    expect(plan.isNoOp).toBe(true)
  })

  it('handles a mixed selection where only some are permitted', () => {
    const permit: PermissionResolver = (t) => (t.id === 'a' ? ALLOW : DENY)
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task({ id: 'a' }), task({ id: 'b' })], permit)
    expect(plan.counts).toMatchObject({ willChange: 1, notPermitted: 1 })
  })
})

describe('per-operation planning', () => {
  it('assign skips someone already assigned', () => {
    const tasks = [task({ id: 'a', assigneeIds: ['u1'] }), task({ id: 'b', assigneeIds: [] })]
    const plan = planBulkOperation({ kind: 'assign', targetId: 'u1', targetLabel: 'Bobby' }, tasks, allowAll)
    expect(plan.counts).toMatchObject({ willChange: 1, alreadyMatches: 1 })
  })

  it('unassign skips someone who is not assigned', () => {
    const tasks = [task({ id: 'a', assigneeIds: ['u1'] }), task({ id: 'b', assigneeIds: [] })]
    const plan = planBulkOperation({ kind: 'unassign', targetId: 'u1', targetLabel: 'Bobby' }, tasks, allowAll)
    expect(plan.counts).toMatchObject({ willChange: 1, alreadyMatches: 1 })
  })

  it('label skips a task that already has it', () => {
    const tasks = [task({ id: 'a', tagIds: ['g1'] }), task({ id: 'b', tagIds: [] })]
    const plan = planBulkOperation({ kind: 'label', targetId: 'g1', targetLabel: 'Urgent' }, tasks, allowAll)
    expect(plan.counts).toMatchObject({ willChange: 1, alreadyMatches: 1 })
  })

  it('due_date compares calendar days, not instants', () => {
    // Same day, different times of day. Setting it again is not a change.
    const tasks = [task({ due_date: '2026-08-24T09:00:00Z' })]
    const plan = planBulkOperation({ kind: 'due_date', dueDate: '2026-08-24' }, tasks, allowAll)
    expect(plan.items[0].outcome).toBe('already_matches')
  })

  it('due_date treats clearing an already-empty date as a no-op', () => {
    const plan = planBulkOperation({ kind: 'due_date', dueDate: null }, [task({ due_date: null })], allowAll)
    expect(plan.items[0].outcome).toBe('already_matches')
  })

  it('shift_dates cannot shift a task with no due date', () => {
    const tasks = [task({ id: 'a', due_date: '2026-08-24T00:00:00Z' }), task({ id: 'b', due_date: null })]
    const plan = planBulkOperation({ kind: 'shift_dates', shiftDays: 7 }, tasks, allowAll)
    expect(plan.counts).toMatchObject({ willChange: 1, alreadyMatches: 1 })
    expect(plan.items[0].after).toBe('2026-08-31')
  })

  it('shift_dates of zero days is a no-op', () => {
    const plan = planBulkOperation({ kind: 'shift_dates', shiftDays: 0 }, [task({ due_date: '2026-08-24T00:00:00Z' })], allowAll)
    expect(plan.isNoOp).toBe(true)
  })

  it('shift_dates moves backwards for a negative shift', () => {
    const plan = planBulkOperation({ kind: 'shift_dates', shiftDays: -3 }, [task({ due_date: '2026-08-24T00:00:00Z' })], allowAll)
    expect(plan.items[0].after).toBe('2026-08-21')
  })

  it('archive skips an already-archived task', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', archived_at: '2026-01-01T00:00:00Z' })]
    const plan = planBulkOperation({ kind: 'archive' }, tasks, allowAll)
    expect(plan.counts).toMatchObject({ willChange: 1, alreadyMatches: 1 })
  })
})

describe('destructive operations demand confirmation', () => {
  it('archive builds a confirmation naming the real count', () => {
    const plan = planBulkOperation({ kind: 'archive' }, [task({ id: 'a' }), task({ id: 'b' })], allowAll)
    expect(plan.destructive).toBe(true)
    expect(plan.confirmation).toMatch(/Archive 2 tasks\?/)
  })

  it('delete says where the tasks go', () => {
    const plan = planBulkOperation({ kind: 'delete' }, [task()], allowAll)
    expect(plan.confirmation).toMatch(/recycle bin/)
  })

  it('the confirmation counts only what will change, not the selection size', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', archived_at: '2026-01-01T00:00:00Z' })]
    const plan = planBulkOperation({ kind: 'archive' }, tasks, allowAll)
    expect(plan.confirmation).toMatch(/Archive 1 task\?/)
  })

  it('mentions items being left alone when some are not permitted', () => {
    const permit: PermissionResolver = (t) => (t.id === 'a' ? ALLOW : DENY)
    const plan = planBulkOperation({ kind: 'delete' }, [task({ id: 'a' }), task({ id: 'b' })], permit)
    expect(plan.confirmation).toMatch(/1 other in your selection cannot be changed/)
  })

  it('asks for no confirmation when nothing would change', () => {
    const plan = planBulkOperation({ kind: 'archive' }, [task({ archived_at: 'x' })], allowAll)
    expect(plan.confirmation).toBeNull()
  })

  it('a non-destructive operation needs no confirmation', () => {
    expect(planBulkOperation({ kind: 'priority', priority: 1 }, [task()], allowAll).confirmation).toBeNull()
  })
})

describe('runBulkOperation', () => {
  const plan3 = () => planBulkOperation(
    { kind: 'priority', priority: 1 },
    [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
    allowAll,
  )

  it('applies every changeable item', async () => {
    const apply = vi.fn(async (): Promise<ApplyResult> => ({ kind: 'ok' }))
    const report = await runBulkOperation(plan3(), apply, { delay: noDelay })
    expect(apply).toHaveBeenCalledTimes(3)
    expect(report.counts.changed).toBe(3)
    expect(report.changedIds).toEqual(['a', 'b', 'c'])
  })

  it('does not call the network for an item that already matches', async () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 3 }, [task({ priority: 3 })], allowAll)
    const apply = vi.fn(async (): Promise<ApplyResult> => ({ kind: 'ok' }))
    const report = await runBulkOperation(plan, apply, { delay: noDelay })
    expect(apply).not.toHaveBeenCalled()
    expect(report.counts.unchanged).toBe(1)
  })

  it('does not call the network for an item that is not permitted', async () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task()], denyAll)
    const apply = vi.fn(async (): Promise<ApplyResult> => ({ kind: 'ok' }))
    const report = await runBulkOperation(plan, apply, { delay: noDelay })
    expect(apply).not.toHaveBeenCalled()
    expect(report.counts.refused).toBe(1)
  })

  it('counts an RLS refusal as refused, never as changed', async () => {
    const apply = async (): Promise<ApplyResult> => ({ kind: 'refused' })
    const report = await runBulkOperation(plan3(), apply, { delay: noDelay })
    expect(report.counts.refused).toBe(3)
    expect(report.counts.changed).toBe(0)
    expect(report.changedIds).toEqual([])
  })

  it('never retries a refusal - the answer will not change', async () => {
    const apply = vi.fn(async (): Promise<ApplyResult> => ({ kind: 'refused' }))
    await runBulkOperation(plan3(), apply, { maxAttempts: 3, delay: noDelay })
    expect(apply).toHaveBeenCalledTimes(3) // once per item, not three times each
  })

  it('treats an invisible write as a change, not a failure', async () => {
    // Migration-102 territory: a write that succeeds and moves the row out of view.
    const apply = async (): Promise<ApplyResult> => ({ kind: 'invisible' })
    const report = await runBulkOperation(plan3(), apply, { delay: noDelay })
    expect(report.counts.changed).toBe(3)
    expect(report.items[0].message).toMatch(/no longer visible/)
  })

  it('retries a transient error and records the attempt count', async () => {
    let calls = 0
    const apply = async (): Promise<ApplyResult> => {
      calls++
      return calls === 1 ? { kind: 'error', message: 'network', retryable: true } : { kind: 'ok' }
    }
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task()], allowAll)
    const report = await runBulkOperation(plan, apply, { delay: noDelay })
    expect(report.counts.changed).toBe(1)
    expect(report.items[0].attempts).toBe(2)
  })

  it('gives up after maxAttempts and reports the error', async () => {
    const apply = async (): Promise<ApplyResult> => ({ kind: 'error', message: 'still down', retryable: true })
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task()], allowAll)
    const report = await runBulkOperation(plan, apply, { maxAttempts: 3, delay: noDelay })
    expect(report.counts.error).toBe(1)
    expect(report.items[0].attempts).toBe(3)
    expect(report.retryableIds).toEqual(['t1'])
  })

  it('does not retry an error marked non-retryable', async () => {
    const apply = vi.fn(async (): Promise<ApplyResult> => ({ kind: 'error', message: 'bad input', retryable: false }))
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task()], allowAll)
    await runBulkOperation(plan, apply, { maxAttempts: 5, delay: noDelay })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('catches a thrown exception rather than aborting the whole batch', async () => {
    let n = 0
    const apply = async (): Promise<ApplyResult> => {
      n++
      if (n <= 2) throw new Error('boom')
      return { kind: 'ok' }
    }
    const report = await runBulkOperation(plan3(), apply, { maxAttempts: 1, delay: noDelay })
    // First two threw and were not retried; the third still ran.
    expect(report.counts.error).toBe(2)
    expect(report.counts.changed).toBe(1)
  })

  it('keeps going after one item fails, so a single bad row cannot block the rest', async () => {
    const apply = async (id: string): Promise<ApplyResult> =>
      id === 'b' ? { kind: 'error', message: 'nope', retryable: false } : { kind: 'ok' }
    const report = await runBulkOperation(plan3(), apply, { delay: noDelay })
    expect(report.counts).toMatchObject({ changed: 2, error: 1 })
  })

  it('reports progress for every item, including skipped ones', async () => {
    const seen: number[] = []
    const plan = planBulkOperation(
      { kind: 'priority', priority: 3 },
      [task({ id: 'a', priority: 1 }), task({ id: 'b', priority: 3 })],
      allowAll,
    )
    await runBulkOperation(plan, async () => ({ kind: 'ok' }), { delay: noDelay, onProgress: (d) => seen.push(d) })
    expect(seen).toEqual([1, 2])
  })

  it('stops when aborted, and says which items were never reached', async () => {
    const signal = { aborted: false }
    const apply = async (): Promise<ApplyResult> => {
      signal.aborted = true // abort after the first item
      return { kind: 'ok' }
    }
    const report = await runBulkOperation(plan3(), apply, { delay: noDelay, signal })
    expect(report.counts.changed).toBe(1)
    expect(report.items[1].message).toMatch(/Stopped before this item/)
    expect(report.items).toHaveLength(3) // nothing vanishes from the accounting
  })

  it('accounts for every selected task in the report', async () => {
    const permit: PermissionResolver = (t) => (t.id === 'c' ? DENY : ALLOW)
    const plan = planBulkOperation(
      { kind: 'priority', priority: 1 },
      [task({ id: 'a' }), task({ id: 'b', priority: 1 }), task({ id: 'c' })],
      permit,
    )
    const report = await runBulkOperation(plan, async () => ({ kind: 'ok' }), { delay: noDelay })
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(3)
  })
})

describe('summarizeRun never calls a partial failure a success', () => {
  const run = (counts: Partial<Record<string, number>>, len: number) => ({
    kind: 'priority' as const,
    items: Array.from({ length: len }, (_, i) => ({ taskId: `t${i}`, title: 'x', status: 'changed' as const, attempts: 1 })),
    counts: { changed: 0, unchanged: 0, refused: 0, error: 0, ...counts } as any,
    changedIds: [], retryableIds: [],
    startedAt: '', finishedAt: '',
  })

  it('is an error when anything errored', () => {
    expect(summarizeRun(run({ changed: 8, error: 2 }, 10)).tone).toBe('error')
  })

  it('mentions the downloadable report when something errored', () => {
    expect(summarizeRun(run({ changed: 8, error: 2 }, 10)).description).toMatch(/Download the report/)
  })

  it('is a warning when anything was refused', () => {
    const s = summarizeRun(run({ changed: 8, refused: 2 }, 10))
    expect(s.tone).toBe('warning')
    expect(s.title).toBe('8 of 10 updated')
  })

  it('is a warning when nothing changed at all', () => {
    expect(summarizeRun(run({ unchanged: 5 }, 5)).tone).toBe('warning')
  })

  it('is a success only when everything that could change did', () => {
    expect(summarizeRun(run({ changed: 10 }, 10)).tone).toBe('success')
  })

  it('still says what was left alone on a success', () => {
    expect(summarizeRun(run({ changed: 8, unchanged: 2 }, 10)).description).toMatch(/2 already matched/)
  })
})

describe('bulkReportCsv', () => {
  const report = {
    kind: 'priority' as const,
    items: [
      { taskId: 'a', title: 'Simple', status: 'changed' as const, attempts: 1 },
      { taskId: 'b', title: 'Has, a comma', status: 'refused' as const, message: 'No permission', attempts: 0 },
      { taskId: 'c', title: 'Has "quotes"', status: 'error' as const, message: 'network', attempts: 2 },
    ],
    counts: { changed: 1, unchanged: 0, refused: 1, error: 1 },
    changedIds: ['a'], retryableIds: ['c'], startedAt: '', finishedAt: '',
  }

  it('has a header and one row per item', () => {
    const lines = bulkReportCsv(report).split('\n')
    expect(lines[0]).toBe('task_id,title,result,attempts,detail')
    expect(lines).toHaveLength(4)
  })

  it('quotes a title containing a comma so the columns do not shift', () => {
    expect(bulkReportCsv(report)).toContain('"Has, a comma"')
  })

  it('doubles embedded quotes per RFC 4180', () => {
    expect(bulkReportCsv(report)).toContain('"Has ""quotes"""')
  })

  it('includes the failure detail, which is the reason to download it', () => {
    expect(bulkReportCsv(report)).toContain('network')
    expect(bulkReportCsv(report)).toContain('No permission')
  })
})

describe('every operation the engine implements is reachable from the UI', () => {
  it('ALL_OPERATIONS covers the BulkOperationKind union exactly once', () => {
    // A duplicate would render two identical buttons; a gap would be dead code.
    expect(new Set(ALL_OPERATIONS).size).toBe(ALL_OPERATIONS.length)
    expect(ALL_OPERATIONS).toHaveLength(11)
  })

  it('every operation has a label, so none can render as a blank button', () => {
    for (const kind of ALL_OPERATIONS) {
      expect(OPERATION_LABELS[kind]).toBeTruthy()
    }
  })

  it('every operation can be planned without throwing', () => {
    // The planner has a case per kind. A missing one falls through and returns undefined,
    // which crashes the confirmation rather than refusing cleanly.
    for (const kind of ALL_OPERATIONS) {
      const plan = planBulkOperation({ kind, targetId: 'x', priority: 1, shiftDays: 1, dueDate: '2026-01-01' }, [task()], allowAll)
      expect(plan.items).toHaveLength(1)
      expect(plan.items[0].outcome).toBeDefined()
    }
  })

  it('marks exactly archive and delete as destructive', () => {
    const destructive = ALL_OPERATIONS.filter(
      (k) => planBulkOperation({ kind: k, targetId: 'x', priority: 1, shiftDays: 1 }, [task()], allowAll).destructive,
    )
    expect(destructive).toEqual(['archive', 'delete'])
  })
})


describe('retrying only the transient failures', () => {
  // A run where one task succeeds, one is refused by policy, and one errors transiently.
  async function runMixed() {
    const tasks = [task({ id: 'ok' }), task({ id: 'refused' }), task({ id: 'boom' })]
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, tasks, allowAll)
    const apply = async (id: string): Promise<ApplyResult> =>
      id === 'ok' ? { kind: 'ok' }
      : id === 'refused' ? { kind: 'refused' }
      : { kind: 'error', message: 'network', retryable: true }
    const report = await runBulkOperation(plan, apply, { delay: noDelay })
    return { plan, report }
  }

  it('narrows the plan to the errored ids, never the refused or the changed', async () => {
    const { plan, report } = await runMixed()
    const again = retryPlanFrom(plan, report)
    expect(again.items.map((i) => i.taskId)).toEqual(['boom'])
  })

  it('drops the confirmation, because it was already answered for these items', async () => {
    const tasks = [task({ id: 'boom' })]
    const plan = planBulkOperation({ kind: 'delete' }, tasks, allowAll)
    expect(plan.confirmation).toBeTruthy()
    const report = await runBulkOperation(
      plan,
      async () => ({ kind: 'error', message: 'network', retryable: true }),
      { delay: noDelay },
    )
    const again = retryPlanFrom(plan, report)
    expect(again.confirmation).toBeNull()
    expect(again.destructive).toBe(true)
  })

  it('is a no-op plan when every failure was a refusal', async () => {
    const plan = planBulkOperation({ kind: 'priority', priority: 1 }, [task({ id: 'a' })], allowAll)
    const report = await runBulkOperation(plan, async () => ({ kind: 'refused' }), { delay: noDelay })
    expect(retryPlanFrom(plan, report).isNoOp).toBe(true)
  })

  it('merging keeps every originally selected task exactly once', async () => {
    const { plan, report } = await runMixed()
    const again = retryPlanFrom(plan, report)
    const second = await runBulkOperation(again, async () => ({ kind: 'ok' }), { delay: noDelay })
    const merged = mergeRunReports(report, second)

    expect(merged.items).toHaveLength(3)
    expect(merged.items.map((i) => i.taskId).sort()).toEqual(['boom', 'ok', 'refused'])
    expect(merged.counts.changed).toBe(2)
    expect(merged.counts.refused).toBe(1)
    expect(merged.counts.error).toBe(0)
  })

  it('accumulates attempts across both runs rather than overwriting them', async () => {
    const { plan, report } = await runMixed()
    const firstAttempts = report.items.find((i) => i.taskId === 'boom')!.attempts
    expect(firstAttempts).toBe(3) // exhausted maxAttempts inside the run

    const again = retryPlanFrom(plan, report)
    const second = await runBulkOperation(again, async () => ({ kind: 'ok' }), { delay: noDelay })
    const merged = mergeRunReports(report, second)

    expect(merged.items.find((i) => i.taskId === 'boom')!.attempts).toBe(firstAttempts + 1)
  })

  it('leaves an untouched row exactly as it was', async () => {
    const { plan, report } = await runMixed()
    const again = retryPlanFrom(plan, report)
    const second = await runBulkOperation(again, async () => ({ kind: 'ok' }), { delay: noDelay })
    const merged = mergeRunReports(report, second)

    const before = report.items.find((i) => i.taskId === 'refused')
    expect(merged.items.find((i) => i.taskId === 'refused')).toEqual(before)
  })

  it('a retry that fails again stays retryable and is still not a success', async () => {
    const { plan, report } = await runMixed()
    const again = retryPlanFrom(plan, report)
    const second = await runBulkOperation(
      again,
      async () => ({ kind: 'error', message: 'still down', retryable: true }),
      { delay: noDelay },
    )
    const merged = mergeRunReports(report, second)
    expect(merged.retryableIds).toEqual(['boom'])
    expect(summarizeRun(merged).tone).toBe('error')
  })

  it('preserves the original start time and takes the retry finish time', async () => {
    const { plan, report } = await runMixed()
    const again = retryPlanFrom(plan, report)
    const second = await runBulkOperation(again, async () => ({ kind: 'ok' }), { delay: noDelay })
    const merged = mergeRunReports(report, second)
    expect(merged.startedAt).toBe(report.startedAt)
    expect(merged.finishedAt).toBe(second.finishedAt)
  })
})
