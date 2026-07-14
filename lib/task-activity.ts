import type { SupabaseClient } from '@supabase/supabase-js'

// Fire-and-forget: activity logging should never block or fail the mutation it
// describes, so callers don't need to await or handle errors from this.
export function logTaskActivity(
  supabase: SupabaseClient,
  taskId: string,
  actorId: string | null | undefined,
  action: string
) {
  if (!actorId) return
  supabase.from('task_activity').insert({ task_id: taskId, actor_id: actorId, action }).then(
    ({ error }: { error: { message: string } | null }) => {
      if (error) console.error('[task-activity] Failed to log activity:', error)
    }
  )
}
