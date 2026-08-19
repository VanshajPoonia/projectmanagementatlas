// Shared task field writes.
//
// This exists so the board's kanban card and the ⌘K palette cannot hold two different
// ideas of what "set the priority" means. The palette is a second route to actions the UI
// already offers, and a second route is exactly where a check gets forgotten - the same
// reason `runCommand` refuses a denied command at the point of execution.
//
// Everything here goes through lib/rls-write.ts, so a policy refusal is reported as a
// refusal rather than announced as a save. See that module for why counting rows is the
// only way to tell the two apart, and for the one case where counting is wrong.

import { classifyWrite, type WriteOutcome } from './rls-write'

/** The narrow slice of a Supabase client this module needs; keeps it unit-testable. */
export interface TaskWriter {
  from: (table: string) => any
}

/**
 * Update fields on one task and report honestly whether it landed.
 *
 * ⚠️ Only for columns that are NOT inputs to `private.can_view_task`. Title, description,
 * priority, due date, column and position all qualify. `visibility` and `assigned_to` do
 * not: writing those can make the row invisible to its own author, so `RETURNING` comes
 * back empty on a write that succeeded. Callers touching either must classify the result
 * themselves with a `stillReadable` probe - task-detail-modal.tsx's save does exactly that.
 */
export async function updateTaskFields(
  supabase: TaskWriter,
  taskId: string,
  patch: Record<string, unknown>,
): Promise<WriteOutcome> {
  return classifyWrite(
    await supabase.from('tasks').update(patch).eq('id', taskId).select('id'),
  )
}

/**
 * Move a task to another column, keeping the denormalised `status` string in step.
 *
 * `status` is written alongside `column_id` because both the board and the reports view
 * still read it; migration 063 made `columns.status_key` the source of truth, and this
 * mirror is what has not been retired yet.
 */
export async function moveTaskToColumn(
  supabase: TaskWriter,
  taskId: string,
  column: { id: string; status: string; position: number },
): Promise<WriteOutcome> {
  return updateTaskFields(supabase, taskId, {
    column_id: column.id,
    status: column.status,
    position: column.position,
  })
}

export async function setTaskPriority(
  supabase: TaskWriter,
  taskId: string,
  priority: number,
): Promise<WriteOutcome> {
  return updateTaskFields(supabase, taskId, { priority })
}
