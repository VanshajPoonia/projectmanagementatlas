'use server'

import { createClient } from '@/lib/supabase/server'
import { sendTaskDueSoonEmail } from '@/lib/email'

/**
 * Checks for tasks due within 1-2 days and sends reminder emails
 * This should be called via a cron job or scheduled task
 */
export async function checkDueDateReminders() {
  const supabase = await createClient()
  
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const twoDaysFromNow = new Date(today)
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)
    
    // Get tasks due in the next 1-2 days that aren't completed
    const { data: taskRows } = await supabase
      .from('tasks')
      .select('*, column:columns(board_id, board:boards(archived_at))')
      .is('deleted_at', null)
      .neq('status', 'done')
      .gte('due_date', today.toISOString())
      .lte('due_date', twoDaysFromNow.toISOString())

    // Skip tasks whose board has been archived
    const tasks = (taskRows || []).filter(task => task.column?.board && !task.column.board.archived_at)

    if (tasks.length === 0) return
    
    // Get all assignees for these tasks
    const taskIds = tasks.map(t => t.id)
    const { data: assignees } = await supabase
      .from('task_assignees')
      .select('task_id, user_id, profiles!task_assignees_user_id_fkey(email, full_name)')
      .in('task_id', taskIds)
    
    // Send reminders
    for (const task of tasks) {
      const taskAssignees = assignees?.filter(a => a.task_id === task.id) || []
      const dueDate = new Date(task.due_date)
      const daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      
      for (const assignee of taskAssignees) {
        // Supabase types an embedded relation as an array even when the foreign key is
        // to-one, so `assignee.profiles` is typed `{...}[]` while arriving as an object.
        // Normalize both shapes rather than asserting one of them.
        const profile: any = Array.isArray(assignee.profiles) ? assignee.profiles[0] : assignee.profiles
        if (!profile?.email) continue

        await sendTaskDueSoonEmail(
          profile.email,
          profile.full_name || profile.email,
          task.title,
          task.due_date,
          daysRemaining
        )
      }
    }
    
    console.log(`[v0] Sent ${tasks.length} due date reminder(s)`)
  } catch (error) {
    console.error('[v0] Error checking due date reminders:', error)
  }
}
