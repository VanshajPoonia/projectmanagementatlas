export type StatusBucket = 'to_do' | 'in_progress' | 'done'

export interface TaskActivityRow {
  task_id?: string | null
  action?: string | null
  created_at?: string | null
  event_type?: string | null
  from_value?: unknown
  to_value?: unknown
  metadata?: unknown
}

export interface StatusEvent {
  taskId: string
  from: string
  to: string
  at: number
  source: 'structured' | 'legacy'
}

export interface StatusInterval {
  taskId: string
  key: string
  label: string
  durationMs: number
}

export interface ActivityCoverage {
  totalTasks: number
  tasksWithStatusHistory: number
  completedTasks: number
  completedWithRecordedClose: number
  tasksWithVerifiedIntervals: number
  verifiedIntervals: number
  structuredEvents: number
  legacyEvents: number
}

const LEGACY_STATUS_RE = /changed status from "(.+?)" to "(.+?)"/i

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parsedMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return record(value)
  try {
    return record(JSON.parse(value))
  } catch {
    return null
  }
}

function statusLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  const valueRecord = record(value)
  if (!valueRecord) return null
  for (const key of ['label', 'title', 'status', 'status_key', 'key', 'name', 'value']) {
    const candidate = statusLabel(valueRecord[key])
    if (candidate) return candidate
  }
  return null
}

function metadataStatus(
  metadata: Record<string, unknown> | null,
  direction: 'from' | 'to',
): string | null {
  if (!metadata) return null
  const keys = direction === 'from'
    ? ['from_value', 'from_status', 'fromStatus', 'previous_status', 'previousStatus', 'from']
    : ['to_value', 'to_status', 'toStatus', 'next_status', 'nextStatus', 'to']

  for (const key of keys) {
    const candidate = statusLabel(metadata[key])
    if (candidate) return candidate
  }
  return null
}

function isStructuredStatusEvent(eventType: string | null | undefined): boolean {
  return String(eventType || '').trim().toLowerCase().includes('status')
}

function statusIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export function bucketOf(label: string): StatusBucket {
  const value = statusIdentity(label)
  if (value.includes('done') || value.includes('complete') || value.includes('cancel')) return 'done'
  if (value.includes('progress') || value.includes('going') || value.includes('ongoing')) return 'in_progress'
  return 'to_do'
}

export function parseStatusEvent(row: TaskActivityRow): StatusEvent | null {
  if (!row.task_id) return null
  const at = new Date(row.created_at || '').getTime()
  if (!Number.isFinite(at)) return null

  if (isStructuredStatusEvent(row.event_type)) {
    const metadata = parsedMetadata(row.metadata)
    const from = statusLabel(row.from_value) || metadataStatus(metadata, 'from')
    const to = statusLabel(row.to_value) || metadataStatus(metadata, 'to')
    if (from && to) {
      return { taskId: row.task_id, from, to, at, source: 'structured' }
    }
  }

  const legacyMatch = LEGACY_STATUS_RE.exec(row.action || '')
  if (!legacyMatch) return null
  return {
    taskId: row.task_id,
    from: legacyMatch[1].trim(),
    to: legacyMatch[2].trim(),
    at,
    source: 'legacy',
  }
}

export function buildStatusEventMap(rows: TaskActivityRow[]): Record<string, StatusEvent[]> {
  const eventMap: Record<string, StatusEvent[]> = {}
  for (const row of rows) {
    const event = parseStatusEvent(row)
    if (!event) continue
    ;(eventMap[event.taskId] ||= []).push(event)
  }
  for (const events of Object.values(eventMap)) {
    events.sort((a, b) => a.at - b.at)
  }
  return eventMap
}

function isCancelledStatus(label: string): boolean {
  return statusIdentity(label).includes('cancel')
}

export function findRecordedClose(
  events: StatusEvent[],
  kind: 'completed' | 'cancelled' | 'any' = 'any',
): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (bucketOf(event.to) !== 'done') continue
    if (kind === 'completed' && isCancelledStatus(event.to)) continue
    if (kind === 'cancelled' && !isCancelledStatus(event.to)) continue
    return event.at
  }
  return null
}

// A status duration is trustworthy only when one event records entry into a status and
// the next event records departure from that same status. Missing or contradictory
// history creates a gap, which is intentionally excluded rather than estimated.
export function getVerifiedStatusIntervals(
  activityByTask: Record<string, StatusEvent[]>,
): StatusInterval[] {
  const intervals: StatusInterval[] = []
  for (const [taskId, unsortedEvents] of Object.entries(activityByTask)) {
    const events = [...unsortedEvents].sort((a, b) => a.at - b.at)
    for (let index = 1; index < events.length; index += 1) {
      const entered = events[index - 1]
      const departed = events[index]
      const durationMs = departed.at - entered.at
      if (
        durationMs >= 0
        && statusIdentity(entered.to)
        && statusIdentity(entered.to) === statusIdentity(departed.from)
      ) {
        intervals.push({
          taskId,
          key: statusIdentity(entered.to),
          label: entered.to,
          durationMs,
        })
      }
    }
  }
  return intervals
}

export function summarizeActivityCoverage({
  taskIds,
  completedTaskIds,
  activityByTask,
  intervals,
}: {
  taskIds: string[]
  completedTaskIds: string[]
  activityByTask: Record<string, StatusEvent[]>
  intervals: StatusInterval[]
}): ActivityCoverage {
  const knownTaskIds = new Set(taskIds)
  const statusEvents = Object.values(activityByTask).flat().filter((event) => knownTaskIds.has(event.taskId))
  const completedWithRecordedClose = completedTaskIds.filter(
    (taskId) => findRecordedClose(activityByTask[taskId] || [], 'completed') !== null,
  ).length

  return {
    totalTasks: taskIds.length,
    tasksWithStatusHistory: taskIds.filter((taskId) => (activityByTask[taskId]?.length || 0) > 0).length,
    completedTasks: completedTaskIds.length,
    completedWithRecordedClose,
    tasksWithVerifiedIntervals: new Set(
      intervals.filter((interval) => knownTaskIds.has(interval.taskId)).map((interval) => interval.taskId),
    ).size,
    verifiedIntervals: intervals.filter((interval) => knownTaskIds.has(interval.taskId)).length,
    structuredEvents: statusEvents.filter((event) => event.source === 'structured').length,
    legacyEvents: statusEvents.filter((event) => event.source === 'legacy').length,
  }
}
