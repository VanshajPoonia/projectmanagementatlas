// Assignee helpers. `task_assignees` (many-to-many) is the source of truth for
// who is assigned to a task — every assignee is equal.
//
// `tasks.assigned_to` is retained only as a denormalized "primary assignee"
// mirror (kept in sync with the first assignee) so any legacy reader keeps
// working, and as a fallback for tasks whose task_assignees rows haven't been
// backfilled yet (see scripts/028_backfill_task_assignees.sql).
//
// Queries should embed `task_assignees(user_id)`; names are resolved against a
// `users` (profiles) list the components already hold.

export function getAssigneeIds(task: any): string[] {
  const join = Array.isArray(task?.task_assignees) ? task.task_assignees : []
  const ids = join
    .map((a: any) => (typeof a === 'string' ? a : a?.user_id ?? a?.user?.id))
    .filter(Boolean)
  if (ids.length > 0) return Array.from(new Set(ids)) as string[]

  // Legacy fallback: single assigned_to (string id, or a joined profile object).
  const single = task?.assigned_to
  if (!single) return []
  const id = typeof single === 'string' ? single : single.id
  return id ? [id] : []
}

export function getAssignees(task: any, users: any[]): any[] {
  return getAssigneeIds(task)
    .map((id) => users.find((u) => u?.id === id))
    .filter(Boolean)
}

export function getAssigneeNames(task: any, users: any[]): string[] {
  return getAssignees(task, users).map((u) => u.full_name || u.email)
}

/**
 * Whether a task belongs in `userId`'s personal queue — the shared rule behind the
 * user dashboard, the admin dashboard, and the AI assistant's "mine" scope.
 *
 * Top-level tasks count when assigned to you *or* created by you: raising a task is a
 * claim on it. Subtasks count only when assigned, because adding a subtask to someone
 * else's task is a contribution to their work, not a claim on it — without that
 * distinction, anyone who breaks down a colleague's task inherits all the pieces.
 */
export function isTaskOwnedBy(task: any, userId: string): boolean {
  const assignedToId = typeof task?.assigned_to === 'string' ? task.assigned_to : task?.assigned_to?.id
  const isAssigned = assignedToId === userId || getAssigneeIds(task).includes(userId)

  if (task?.parent_task_id) return isAssigned
  return task?.created_by === userId || isAssigned
}
