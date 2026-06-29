'use server'

import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'

const resend = new Resend(process.env.RESEND_API_KEY)

// Set EMAIL_FROM to an address on a domain you've verified in Resend.
// The resend.dev fallback only delivers to your own Resend account email.
const FROM = process.env.EMAIL_FROM || 'Project Manager <onboarding@resend.dev>'

type EmailRow = { label: string; value: string }

function renderEmail(heading: string, rows: EmailRow[], action: string) {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#475569;white-space:nowrap;vertical-align:top">${label}</td>
          <td style="padding:8px 12px;color:#0f172a">${value}</td>
        </tr>`
    )
    .join('')

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#2563eb;color:#fff;padding:16px 20px;font-size:16px;font-weight:600">${heading}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml}</table>
      <div style="padding:16px 20px;border-top:1px solid #e2e8f0;color:#2563eb;font-size:14px">${action}</div>
    </div>
  </div>`
}

// These functions are Server Actions invokable directly from the client,
// so they're a public RPC endpoint. Require a logged-in session to stop
// anyone from using them to spam arbitrary addresses.
async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

type NotificationColumn =
  | 'notify_email_assignment'
  | 'notify_email_update'
  | 'notify_email_comment'
  | 'notify_email_due_soon'

// Centralized here (rather than at each call site) so every send path is
// covered by one check and a new caller can't accidentally skip it.
async function isNotificationEnabled(recipientEmail: string, column: NotificationColumn) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select(column)
    .eq('email', recipientEmail)
    .single()

  // A lookup failure (e.g. unrecognized email) should never silently
  // swallow a real notification, so default to enabled.
  if (!data) return true
  return (data as Record<string, boolean>)[column] !== false
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.error('[email] RESEND_API_KEY is not set; skipping email to', to)
    return
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html })
    if (error) {
      console.error('[email] Failed to send to', to, error)
    } else {
      console.log('[email] Sent successfully to', to)
    }
  } catch (error) {
    console.error('[email] Error sending email to', to, error)
  }
}

export async function sendTaskAssignmentEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  taskDescription: string,
  priority: string,
  dueDate: string | null,
  boardTitle: string,
  assignedBy: string
) {
  if (!(await requireSession())) return
  if (!(await isNotificationEnabled(recipientEmail, 'notify_email_assignment'))) {
    console.log('[email] Skipped (preference off): assignment to', recipientEmail)
    return
  }

  const html = renderEmail(
    '🔔 New Task Assigned',
    [
      { label: 'Recipient', value: recipientName },
      { label: 'Task', value: taskTitle },
      { label: 'Description', value: taskDescription || 'No description provided' },
      { label: 'Priority', value: `${priority} (1=highest, 5=lowest)` },
      { label: 'Due Date', value: dueDate ? new Date(dueDate).toLocaleDateString() : 'No due date' },
      { label: 'Board', value: boardTitle },
      { label: 'Assigned By', value: assignedBy },
    ],
    '👉 Please log in to view your task details'
  )
  await sendEmail(recipientEmail, `🔔 New Task Assigned: ${taskTitle}`, html)
}

export async function sendTaskUpdateEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  updatedBy: string,
  changes: string
) {
  if (!(await requireSession())) return
  if (!(await isNotificationEnabled(recipientEmail, 'notify_email_update'))) {
    console.log('[email] Skipped (preference off): update to', recipientEmail)
    return
  }

  const html = renderEmail(
    '📝 Task Updated',
    [
      { label: 'Recipient', value: recipientName },
      { label: 'Task', value: taskTitle },
      { label: 'Updated By', value: updatedBy },
      { label: 'Changes', value: changes },
    ],
    '👉 Log in to view the updated task'
  )
  await sendEmail(recipientEmail, `📝 Task Updated: ${taskTitle}`, html)
}

export async function sendCommentEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  commentAuthor: string,
  commentText: string
) {
  if (!(await requireSession())) return
  if (!(await isNotificationEnabled(recipientEmail, 'notify_email_comment'))) {
    console.log('[email] Skipped (preference off): comment to', recipientEmail)
    return
  }

  const html = renderEmail(
    '💬 New Comment',
    [
      { label: 'Recipient', value: recipientName },
      { label: 'Task', value: taskTitle },
      { label: 'Comment By', value: commentAuthor },
      { label: 'Comment', value: commentText },
    ],
    '👉 Log in to reply'
  )
  await sendEmail(recipientEmail, `💬 New Comment on: ${taskTitle}`, html)
}

export async function sendTaskDueSoonEmail(
  recipientEmail: string,
  recipientName: string,
  taskTitle: string,
  dueDate: string,
  daysRemaining: number
) {
  if (!(await isNotificationEnabled(recipientEmail, 'notify_email_due_soon'))) {
    console.log('[email] Skipped (preference off): due-soon to', recipientEmail)
    return
  }

  const html = renderEmail(
    '⏰ Task Due Soon',
    [
      { label: 'Recipient', value: recipientName },
      { label: 'Task', value: taskTitle },
      { label: 'Due Date', value: new Date(dueDate).toLocaleDateString() },
      { label: 'Days Remaining', value: `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}` },
    ],
    '👉 Complete your task soon!'
  )
  await sendEmail(recipientEmail, `⏰ Task Due Soon: ${taskTitle}`, html)
}
