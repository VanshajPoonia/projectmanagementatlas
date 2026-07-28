export interface PublicShareLinkState {
  revoked_at: string | null
  expires_at: string | null
}

export interface PublicTaskState {
  deleted_at?: string | null
  archived_at?: string | null
  column?: {
    board?: {
      archived_at?: string | null
    } | null
  } | null
}

/**
 * Share tokens are generated from two UUIDv4 values with punctuation removed.
 * Rejecting malformed route parameters avoids sending arbitrary strings to the
 * service-role query used by the public share page.
 */
export function isValidShareToken(token: string) {
  return /^[a-f0-9]{64}$/i.test(token)
}

export function isPublicShareLinkActive<T extends PublicShareLinkState>(
  link: T | null | undefined,
  now = Date.now(),
): link is T {
  if (!link || link.revoked_at) return false
  if (!link.expires_at) return true

  const expiry = new Date(link.expires_at).getTime()
  return Number.isFinite(expiry) && expiry > now
}

/**
 * A task cannot be exposed by a capability link once it, or its containing
 * board, has left the active workspace.
 */
export function isPublicTaskAvailable(task: PublicTaskState | null | undefined) {
  return Boolean(
    task
    && !task.deleted_at
    && !task.archived_at
    && !task.column?.board?.archived_at,
  )
}

export function visiblePublicBoardTasks<T extends PublicTaskState>(tasks: T[] | null | undefined) {
  return (tasks || []).filter(task =>
    isPublicTaskAvailable(task)
    && !('parent_task_id' in task && task.parent_task_id),
  )
}
