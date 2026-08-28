import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendTaskDueSoonEmail } from '@/lib/email'

/**
 * The scheduled sweep: generate due recurrence occurrences, deliver due reminders, then take
 * the day's burndown point for every running sprint.
 *
 * WHY THIS ROUTE EXISTS AT ALL
 * Before it, `lib/reminder-service.ts` was a `'use server'` function whose own comment said it
 * "should be called via a cron job or scheduled task" - with no cron, no vercel.json and no
 * call site anywhere in the repo. Migrations 116 and 117 make recurrence and reminders real;
 * this is what actually pulls the trigger, so neither ends up being another control wired to
 * nothing.
 *
 * ⚠️ THE VERCEL PROJECT IS ON THE HOBBY PLAN, WHICH RUNS CRON JOBS ONCE A DAY, MAXIMUM 2.
 * That is a hard hosting limit, not a choice, and it shapes the design:
 *   - Recurrence is unaffected. The backfilled rules are all `on_completion`, which produces
 *     work in response to someone finishing something, and the board calls
 *     run_recurrence_generation directly at that moment. This sweep is the safety net.
 *   - Reminders ARE affected. A daily sweep cannot honour "30 minutes before". The app
 *     therefore also calls `deliver_my_due_reminders()` while it is open (see
 *     components/notifications/use-reminder-delivery.ts), which covers in-app delivery in near
 *     real time for anyone actually using the product. This route remains the only sender of
 *     reminder EMAIL, so email is a once-a-day guarantee and the reminder UI says so.
 * Moving to a paid plan and tightening the schedule in vercel.json is the whole upgrade path;
 * nothing in the database or the app has to change.
 *
 * SAFE TO RETRY, ALWAYS. Both underlying functions are idempotent by construction - 116 via
 * UNIQUE(rule_id, occurrence_date), 117 by claiming rows in the same statement that reads them
 * - so a retried, duplicated or overlapping invocation cannot double-create or double-notify.
 * That is what makes it safe to also expose this to a manual trigger.
 */

export const dynamic = 'force-dynamic'
// Generating a month of occurrences across every rule is not a 10-second job.
export const maxDuration = 60

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * The check is deliberately strict: with no CRON_SECRET configured the route refuses rather
 * than running open. An unauthenticated endpoint that creates tasks and sends email to real
 * people is not something to leave available by omission.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    // 401 with no detail: whether a secret is configured is not something to advertise.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Server is not configured for scheduled work.' }, { status: 500 })
  }

  // The service role is required, not a convenience: deliver_due_reminders is revoked from
  // every client role precisely so only this path can run a full sweep.
  const supabase = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const result = {
    recurrence: { rulesConsidered: 0, tasksCreated: 0, error: null as string | null },
    reminders: { delivered: 0, emailsSent: 0, emailsFailed: 0, error: null as string | null },
    burndown: { sprintsSampled: 0, error: null as string | null },
  }

  // --- recurrence -------------------------------------------------------------------------
  try {
    const { data, error } = await supabase.rpc('run_recurrence_generation', { p_rule_id: null })
    if (error) throw error
    const rows = (data as any[]) ?? []
    result.recurrence.rulesConsidered = rows.length
    result.recurrence.tasksCreated = rows.reduce((n, r) => n + (r.created_count ?? 0), 0)
  } catch (err: any) {
    // Recorded, not thrown: reminders must still be attempted. Reporting a partial sweep
    // honestly is the whole point of returning a body from this route.
    result.recurrence.error = err?.message ?? 'Recurrence generation failed'
  }

  // --- reminders --------------------------------------------------------------------------
  try {
    const { data, error } = await supabase.rpc('deliver_due_reminders', { p_now: null })
    if (error) throw error
    const rows = (data as any[]) ?? []
    result.reminders.delivered = rows.length

    // The in-app notification is already written by the function itself, inside the same
    // transaction that claimed the reminder. Only the email is left to do here.
    const owed = rows.filter((r) => r.wants_email)
    if (owed.length > 0) {
      const ids = Array.from(new Set(owed.map((r) => r.user_id)))
      const { data: profiles } = await supabase
        .from('profiles').select('id, email, full_name').in('id', ids)
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]))

      for (const row of owed) {
        const profile = byId.get(row.user_id)
        if (!profile?.email) continue
        try {
          // The reminder is already marked delivered, so a failure here loses the email and
          // never the in-app notification. That ordering is deliberate: a reminder that fires
          // twice in the inbox is worse than one that arrives only in the app.
          await sendTaskDueSoonEmail(
            profile.email,
            profile.full_name || profile.email,
            row.task_title,
            new Date().toISOString(),
            0,
          )
          result.reminders.emailsSent++
        } catch {
          result.reminders.emailsFailed++
        }
      }
    }
  } catch (err: any) {
    result.reminders.error = err?.message ?? 'Reminder delivery failed'
  }

  // --- sprint burndown (migration 124) --------------------------------------------------
  // The overnight point for every running sprint, on every board - which is why
  // sample_all_active_sprints is revoked from anon and authenticated and reachable only from
  // here, with the service role. The agile page samples TODAY on open for the same sprints, and
  // both paths are idempotent through UNIQUE (sprint_id, on_date), so they cannot disagree or
  // double-count. Without this, a sprint nobody opened on a given day simply has no point, and
  // a gap in a burndown is not the same picture as a flat line.
  try {
    const { data, error } = await supabase.rpc('sample_all_active_sprints')
    if (error) throw error
    result.burndown.sprintsSampled = ((data as any[]) ?? []).length
  } catch (err: any) {
    // Recorded, not thrown - the same rule as the two sweeps above. A missing burndown point
    // must never be the reason a reminder or a recurring task did not happen.
    result.burndown.error = err?.message ?? 'Burndown sampling failed'
  }

  const failed = Boolean(result.recurrence.error || result.reminders.error || result.burndown.error)
  return NextResponse.json(
    { ok: !failed, ranAt: new Date().toISOString(), ...result },
    // 500 on a partial failure so the platform's own cron log shows it, rather than a
    // green tick over a sweep that silently did half its job.
    { status: failed ? 500 : 200 },
  )
}
