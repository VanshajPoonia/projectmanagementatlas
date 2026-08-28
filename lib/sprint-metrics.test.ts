import { describe, it, expect } from 'vitest'
import {
  METRIC_DEFINITIONS, explainMetric,
  computeLiveMetrics, metricsFromSnapshot, sprintMetrics,
  burndownSeries, velocity, explainVelocity,
  type SprintMetricsRow, type BurndownSampleRow, type SprintMemberRow,
} from './sprint-metrics'
import type { SprintLike } from './agile'

const STATUSES = [
  { key: 'to_do', category: 'planned' as const, is_closed: false },
  { key: 'in_progress', category: 'started' as const, is_closed: false },
  { key: 'done', category: 'completed' as const, is_closed: true },
  { key: 'cancelled', category: 'cancelled' as const, is_closed: true },
]

const NOW = '2026-09-08T12:00:00.000Z'

const sprint = (over: Partial<SprintLike> = {}): SprintLike & { id: string; title: string } => ({
  id: over.id ?? 's1',
  title: over.title ?? 'Window 1',
  start_date: over.start_date ?? '2026-09-01',
  end_date: over.end_date ?? '2026-09-14',
  state: over.state ?? 'active',
  capacity: over.capacity ?? 20,
})

const member = (taskId: string, over: Partial<SprintMemberRow> = {}): SprintMemberRow => ({
  task_id: taskId,
  committed: over.committed ?? true,
  estimate_at_commit: over.estimate_at_commit ?? null,
  removed_at: over.removed_at ?? null,
})

const task = (id: string, statusKey: string, estimate: number | null) => ({
  id, estimate_value: estimate, column: { status_key: statusKey },
})

describe('every metric carries its own explanation', () => {
  it('defines all seven Prompt G names', () => {
    for (const id of ['committed', 'completed', 'carryover', 'scope_added', 'scope_removed', 'burndown', 'burnup', 'velocity'] as const) {
      const def = METRIC_DEFINITIONS[id]
      expect(def.definition.length).toBeGreaterThan(20)
      expect(def.formula.length).toBeGreaterThan(20)
      expect(def.excludes.length).toBeGreaterThan(20)
    }
  })

  it('builds the footnote from the value, so a caption cannot drift from the maths', () => {
    const set = computeLiveMetrics({
      sprint: sprint(), members: [member('t1', { estimate_at_commit: 3 })],
      tasks: [task('t1', 'done', 3)], statuses: STATUSES, unit: 'points', now: NOW,
    })
    const text = explainMetric(set.completed)
    expect(text).toContain('in points')
    expect(text).toContain('Excludes:')
    expect(text).toContain('Live')
  })

  it('says an unestimated item counted as zero rather than staying quiet about it', () => {
    const set = computeLiveMetrics({
      sprint: sprint(), members: [member('t1'), member('t2')],
      tasks: [task('t1', 'done', null), task('t2', 'done', 5)], statuses: STATUSES, unit: 'points', now: NOW,
    })
    expect(set.completed.unestimated).toBe(1)
    expect(explainMetric(set.completed)).toContain('carries no estimate')
  })
})

describe('live metrics over a running window', () => {
  const members = [
    member('a', { committed: true, estimate_at_commit: 5 }),
    member('b', { committed: true, estimate_at_commit: 3 }),
    member('c', { committed: false, estimate_at_commit: 2 }),          // scope added
    member('d', { committed: true, estimate_at_commit: 8, removed_at: '2026-09-05T00:00:00Z' }), // removed
  ]
  const tasks = [
    task('a', 'done', 5),
    task('b', 'in_progress', 3),
    task('c', 'to_do', 2),
    task('d', 'to_do', 8),
  ]
  const set = computeLiveMetrics({ sprint: sprint(), members, tasks, statuses: STATUSES, unit: 'points', now: NOW })

  it('counts the commitment from the estimate AS IT WAS, not today\'s', () => {
    expect(set.committed.count).toBe(3)   // a, b, d - d was committed even though later removed
    expect(set.committed.estimate).toBe(16)
  })

  it('re-estimating a task afterwards does not rewrite the commitment', () => {
    const resized = computeLiveMetrics({
      sprint: sprint(), members, tasks: tasks.map((t) => ({ ...t, estimate_value: 100 })),
      statuses: STATUSES, unit: 'points', now: NOW,
    })
    expect(resized.committed.estimate).toBe(16)
    // ...but the live "completed" figure does move, because that is what live means.
    expect(resized.completed.estimate).toBe(100)
  })

  it('counts completed, carryover and scope separately', () => {
    expect(set.completed.count).toBe(1)
    expect(set.completed.estimate).toBe(5)
    expect(set.carryover.count).toBe(2)   // b (in progress) and c (to do); d was removed
    expect(set.scopeAdded.count).toBe(1)
    expect(set.scopeAdded.estimate).toBe(2)
    expect(set.scopeRemoved.count).toBe(1)
    expect(set.scopeRemoved.estimate).toBe(8)
  })

  it('never counts removed work in the live totals', () => {
    expect(set.completed.includedTaskIds).not.toContain('d')
    expect(set.carryover.includedTaskIds).not.toContain('d')
    expect(set.finalCount).toBe(3)
  })

  it('keeps cancelled work out of "completed", though both are closed', () => {
    const s = computeLiveMetrics({
      sprint: sprint(), members: [member('x'), member('y')],
      tasks: [task('x', 'cancelled', 4), task('y', 'done', 4)], statuses: STATUSES, unit: 'points', now: NOW,
    })
    expect(s.completed.count).toBe(1)
    expect(s.cancelledCount).toBe(1)
    // Cancelled is closed, so it is not carryover either.
    expect(s.carryover.count).toBe(0)
  })

  it('lists exactly the ids it counted', () => {
    expect(set.completed.includedTaskIds).toEqual(['a'])
    expect(set.carryover.includedTaskIds.sort()).toEqual(['b', 'c'])
  })
})

describe('a closed window is read frozen, never recomputed', () => {
  const snapshot: SprintMetricsRow = {
    sprint_id: 's1', captured_at: '2026-09-15T00:00:00.000Z', final_state: 'completed',
    estimate_unit: 'points', terminology: 'sprint',
    committed_count: 4, committed_estimate: '18.00',
    completed_count: 3, completed_estimate: '13.00',
    carryover_count: 1, carryover_estimate: '5.00',
    cancelled_count: 0,
    added_count: 1, added_estimate: '2.00',
    removed_count: 1, removed_estimate: '8.00',
    final_count: 4, final_estimate: '18.00',
    included_task_ids: ['a', 'b', 'c', 'd'], unestimated_count: 0, capacity: '20.00',
  }

  it('reads numeric strings from PostgREST as numbers', () => {
    const set = metricsFromSnapshot(snapshot)
    expect(set.completed.estimate).toBe(13)
    expect(set.capacity).toBe(20)
  })

  it('labels itself frozen and stamps when it was captured', () => {
    const set = metricsFromSnapshot(snapshot)
    expect(set.source).toBe('frozen')
    expect(set.lastUpdated).toBe('2026-09-15T00:00:00.000Z')
    expect(explainMetric(set.completed)).toContain('Frozen')
  })

  it('IGNORES current task rows entirely - the whole point of the snapshot', () => {
    const set = sprintMetrics({
      sprint: sprint({ state: 'completed' }), snapshot,
      // Every task re-estimated to 999 and re-opened since the window closed.
      members: [member('a'), member('b')],
      tasks: [task('a', 'to_do', 999), task('b', 'to_do', 999)],
      statuses: STATUSES, unit: 'points', now: NOW,
    })!
    expect(set.completed.estimate).toBe(13)
    expect(set.source).toBe('frozen')
  })

  it('returns null - never a live recomputation - for a closed window with no record', () => {
    const set = sprintMetrics({
      sprint: sprint({ state: 'completed' }), snapshot: null,
      members: [member('a')], tasks: [task('a', 'done', 5)],
      statuses: STATUSES, unit: 'points', now: NOW,
    })
    expect(set).toBeNull()
  })

  it('computes live for a window that is still open', () => {
    const set = sprintMetrics({
      sprint: sprint({ state: 'active' }), snapshot: null,
      members: [member('a')], tasks: [task('a', 'done', 5)],
      statuses: STATUSES, unit: 'points', now: NOW,
    })!
    expect(set.source).toBe('live')
    expect(set.completed.estimate).toBe(5)
  })

  it('keeps the unit the window was counted in, not the board\'s current one', () => {
    const set = metricsFromSnapshot({ ...snapshot, estimate_unit: 'hours' })
    expect(set.unit).toBe('hours')
  })
})

describe('burndown draws gaps as gaps', () => {
  const samples: BurndownSampleRow[] = [
    { sprint_id: 's1', on_date: '2026-09-01', remaining_count: 4, remaining_estimate: '20.00', completed_count: 0, completed_estimate: '0.00', scope_count: 4, scope_estimate: '20.00', unestimated_count: 0, captured_at: '2026-09-01T10:00:00Z' },
    { sprint_id: 's1', on_date: '2026-09-03', remaining_count: 3, remaining_estimate: '13.00', completed_count: 1, completed_estimate: '7.00', scope_count: 4, scope_estimate: '20.00', unestimated_count: 0, captured_at: '2026-09-03T10:00:00Z' },
  ]
  const series = burndownSeries({ sprint: sprint(), samples, unit: 'points', today: '2026-09-05' })

  it('has one point per calendar day of the window', () => {
    expect(series.points).toHaveLength(14)
    expect(series.points[0].date).toBe('2026-09-01')
  })

  it('leaves an unsampled past day NULL rather than drawing a cliff to zero', () => {
    const sep2 = series.points.find((p) => p.date === '2026-09-02')!
    expect(sep2.remaining).toBeNull()
    expect(sep2.completed).toBeNull()
  })

  it('counts and reports the missing days so the chart can label itself', () => {
    // Sep 2, 4, 5 are past and unsampled.
    expect(series.missingDays).toBe(3)
  })

  it('does not count future days as missing', () => {
    expect(series.points.filter((p) => p.isFuture)).toHaveLength(9)
  })

  it('draws the ideal line from the starting scope down to zero', () => {
    expect(series.startingScope).toBe(20)
    expect(series.points[0].ideal).toBe(20)
    expect(series.points[series.points.length - 1].ideal).toBe(0)
  })

  it('reports when it was last sampled', () => {
    expect(series.lastUpdated).toBe('2026-09-03T10:00:00Z')
  })

  it('survives a window with no samples at all', () => {
    const empty = burndownSeries({ sprint: sprint(), samples: [], unit: 'points', today: '2026-09-05' })
    expect(empty.startingScope).toBe(0)
    expect(empty.lastUpdated).toBeNull()
    expect(empty.points.every((p) => p.remaining === null)).toBe(true)
  })

  it('carries the scope series, so burn-up can show scope growth a burndown hides', () => {
    expect(series.points[0].scope).toBe(20)
  })
})

describe('velocity averages only frozen, completed, same-unit windows', () => {
  const snap = (id: string, over: Partial<SprintMetricsRow> = {}): SprintMetricsRow => ({
    sprint_id: id, captured_at: over.captured_at ?? '2026-09-15T00:00:00.000Z', final_state: 'completed',
    estimate_unit: over.estimate_unit ?? 'points', terminology: 'sprint',
    committed_count: 0, committed_estimate: 0, completed_count: 0,
    completed_estimate: over.completed_estimate ?? 10,
    carryover_count: 0, carryover_estimate: 0, cancelled_count: 0,
    added_count: 0, added_estimate: 0, removed_count: 0, removed_estimate: 0,
    final_count: 0, final_estimate: 0, included_task_ids: [], unestimated_count: 0, capacity: null,
  })

  it('averages the completed estimate', () => {
    const sprints = [
      sprint({ id: 'a', state: 'completed', end_date: '2026-08-14' }),
      sprint({ id: 'b', state: 'completed', end_date: '2026-08-28' }),
    ]
    const v = velocity({ sprints, snapshots: [snap('a', { completed_estimate: 12 }), snap('b', { completed_estimate: 18 })], unit: 'points' })
    expect(v.average).toBe(15)
    expect(v.included).toHaveLength(2)
  })

  it('excludes a cancelled window and says why', () => {
    const sprints = [sprint({ id: 'x', state: 'cancelled', end_date: '2026-08-14' })]
    const v = velocity({ sprints, snapshots: [snap('x')], unit: 'points' })
    expect(v.included).toHaveLength(0)
    expect(v.excluded[0].reason).toContain('not delivered')
  })

  it('excludes a still-open window', () => {
    const v = velocity({ sprints: [sprint({ id: 'r', state: 'active' })], snapshots: [], unit: 'points' })
    expect(v.excluded[0].reason).toContain('Still open')
  })

  it('excludes a completed window with no frozen record rather than recomputing it', () => {
    const v = velocity({ sprints: [sprint({ id: 'g', state: 'completed', end_date: '2026-08-01' })], snapshots: [], unit: 'points' })
    expect(v.included).toHaveLength(0)
    expect(v.excluded[0].reason).toContain('No frozen record')
  })

  it('never converts between units - it excludes and says so', () => {
    const sprints = [sprint({ id: 'h', state: 'completed', end_date: '2026-08-14' })]
    const v = velocity({ sprints, snapshots: [snap('h', { estimate_unit: 'hours' })], unit: 'points' })
    expect(v.included).toHaveLength(0)
    expect(v.excluded[0].reason).toContain('never converted')
  })

  it('takes the most recent N by end date, newest first', () => {
    const sprints = ['2026-05-01', '2026-06-01', '2026-07-01'].map((d, i) =>
      sprint({ id: `s${i}`, state: 'completed', end_date: d }))
    const snaps = sprints.map((s, i) => snap(s.id, { completed_estimate: (i + 1) * 10 }))
    const v = velocity({ sprints, snapshots: snaps, unit: 'points', take: 2 })
    expect(v.included.map((s) => s.sprintId)).toEqual(['s2', 's1'])
    expect(v.average).toBe(25)
    expect(v.excluded[0].reason).toContain('Older than the last 2')
  })

  it('reports zero and explains it, rather than dividing by nothing', () => {
    const v = velocity({ sprints: [], snapshots: [], unit: 'points' })
    expect(v.average).toBe(0)
    expect(explainVelocity(v)).toContain('nothing to average')
  })
})
