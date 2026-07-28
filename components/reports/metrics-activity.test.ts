import { describe, expect, it } from 'vitest'
import {
  buildStatusEventMap,
  findRecordedClose,
  getVerifiedStatusIntervals,
  parseStatusEvent,
  summarizeActivityCoverage,
  type StatusEvent,
} from './metrics-activity'

const hour = 60 * 60 * 1000

function event(
  taskId: string,
  from: string,
  to: string,
  at: number,
  source: StatusEvent['source'] = 'structured',
): StatusEvent {
  return { taskId, from, to, at, source }
}

describe('status activity parsing', () => {
  it('prefers structured status fields over the legacy action string', () => {
    expect(parseStatusEvent({
      task_id: 'task-1',
      created_at: '2026-07-01T12:00:00.000Z',
      event_type: 'task.status_changed',
      from_value: { key: 'to_do', label: 'To Do' },
      to_value: { key: 'in_progress', label: 'In Progress' },
      action: 'changed status from "Wrong" to "Done"',
    })).toEqual({
      taskId: 'task-1',
      from: 'To Do',
      to: 'In Progress',
      at: Date.parse('2026-07-01T12:00:00.000Z'),
      source: 'structured',
    })
  })

  it('reads status values from JSON metadata', () => {
    expect(parseStatusEvent({
      task_id: 'task-1',
      created_at: '2026-07-01T12:00:00.000Z',
      event_type: 'status_changed',
      metadata: JSON.stringify({
        previous_status: { label: 'In Progress' },
        next_status: { label: 'Completed' },
      }),
    })?.to).toBe('Completed')
  })

  it('falls back to legacy action strings and ignores unrelated or invalid rows', () => {
    expect(parseStatusEvent({
      task_id: 'task-2',
      created_at: '2026-07-02T12:00:00.000Z',
      action: 'changed status from "To Do" to "Done"',
    })?.source).toBe('legacy')

    expect(parseStatusEvent({
      task_id: 'task-2',
      created_at: '2026-07-02T12:00:00.000Z',
      event_type: 'title_changed',
      from_value: 'Old title',
      to_value: 'New title',
    })).toBeNull()
    expect(parseStatusEvent({
      task_id: 'task-2',
      created_at: 'not-a-date',
      action: 'changed status from "To Do" to "Done"',
    })).toBeNull()
  })

  it('groups events by task and sorts them chronologically', () => {
    const activity = buildStatusEventMap([
      {
        task_id: 'task-1',
        created_at: '2026-07-02T12:00:00.000Z',
        action: 'changed status from "In Progress" to "Done"',
      },
      {
        task_id: 'task-1',
        created_at: '2026-07-01T12:00:00.000Z',
        action: 'changed status from "To Do" to "In Progress"',
      },
    ])

    expect(activity['task-1'].map(({ to }) => to)).toEqual(['In Progress', 'Done'])
  })
})

describe('defensible timing metrics', () => {
  it('uses an explicit transition into a closed status as the close time', () => {
    const events = [
      event('task-1', 'To Do', 'Done', hour),
      event('task-1', 'Done', 'In Progress', hour * 2),
      event('task-1', 'In Progress', 'Completed', hour * 4),
    ]

    expect(findRecordedClose(events)).toBe(hour * 4)
    expect(findRecordedClose([event('task-1', 'To Do', 'In Progress', hour)])).toBeNull()
    expect(findRecordedClose([event('task-1', 'To Do', 'Cancelled', hour)], 'completed')).toBeNull()
    expect(findRecordedClose([event('task-1', 'To Do', 'Cancelled', hour)], 'cancelled')).toBe(hour)
  })

  it('only measures status intervals bounded by matching entry and exit events', () => {
    const intervals = getVerifiedStatusIntervals({
      complete: [
        event('complete', 'To Do', 'In Progress', hour),
        event('complete', 'In Progress', 'Review', hour * 4),
        event('complete', 'Review', 'Done', hour * 6),
      ],
      gap: [
        event('gap', 'To Do', 'In Progress', hour),
        event('gap', 'Review', 'Done', hour * 10),
      ],
    })

    expect(intervals).toEqual([
      { taskId: 'complete', key: 'in_progress', label: 'In Progress', durationMs: hour * 3 },
      { taskId: 'complete', key: 'review', label: 'Review', durationMs: hour * 2 },
    ])
  })

  it('reports sparse-history coverage without counting unrelated tasks', () => {
    const activityByTask = {
      'task-1': [event('task-1', 'To Do', 'Done', hour, 'structured')],
      'task-2': [
        event('task-2', 'To Do', 'In Progress', hour, 'legacy'),
        event('task-2', 'In Progress', 'Review', hour * 2, 'legacy'),
      ],
      unrelated: [event('unrelated', 'To Do', 'Done', hour, 'structured')],
    }
    const intervals = getVerifiedStatusIntervals(activityByTask)

    expect(summarizeActivityCoverage({
      taskIds: ['task-1', 'task-2', 'task-3'],
      completedTaskIds: ['task-1', 'task-3'],
      activityByTask,
      intervals,
    })).toEqual({
      totalTasks: 3,
      tasksWithStatusHistory: 2,
      completedTasks: 2,
      completedWithRecordedClose: 1,
      tasksWithVerifiedIntervals: 1,
      verifiedIntervals: 1,
      structuredEvents: 1,
      legacyEvents: 2,
    })
  })
})
