export type NormalizedTaskStatus = 'to_do' | 'in_progress' | 'done'

function text(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function getNormalizedTaskStatus(task: any): NormalizedTaskStatus {
  const status = text(task?.status).replace(/\s+/g, '_')
  const columnTitle = text(task?.column?.title)

  if (status === 'done' || status.includes('complete') || columnTitle.includes('done') || columnTitle.includes('complete')) {
    return 'done'
  }

  if (
    status === 'in_progress'
    || status.includes('progress')
    || status.includes('going')
    || status.includes('ongoing')
    || columnTitle.includes('progress')
    || columnTitle.includes('going')
    || columnTitle.includes('ongoing')
  ) {
    return 'in_progress'
  }

  return 'to_do'
}

export function getTaskStatusLabel(task: any) {
  const normalized = getNormalizedTaskStatus(task)

  if (normalized === 'done') return 'Done'
  if (normalized === 'in_progress') return 'In Progress'
  return 'To Do'
}
