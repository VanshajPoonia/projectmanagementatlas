-- 117: personal, per-user task reminders that actually fire.
--
-- WHAT IS WRONG
-- 045 added notify_email_due_soon to `profiles` and account-settings.tsx renders it as "Due date
-- reminders - when a task is due in 1-2 days". lib/reminder-service.ts implements exactly that,
-- and its own comment says it "should be called via a cron job or scheduled task".
--
-- Nothing calls it. There is no vercel.json, no cron, and no call site anywhere in the repo -
-- grepped, not assumed. So the preference is a switch wired to nothing, and a user who turns it
-- on is told reminders are on. Third instance of this defect in this codebase after
-- profiles.is_active (101) and the recurrence columns (116).
--
-- Its query is also stale in a way that would misfire if it ever were called: it filters
-- `.neq('status', 'done')` against the raw status TEXT column, which 112 replaced with
-- categories. A cancelled task is not 'done', so it would be reminded about; and a board whose
-- statuses were renamed has tasks whose text status matches nothing.
--
-- WHAT PROMPT D ASKS FOR
--   "Design for multiple per-user reminders. A reminder is not necessarily a global task
--    property."
--
-- That second sentence is the design. A reminder belongs to a PERSON, not to a task: two people
-- watching the same task want different warning times, and neither should see or disturb the
-- other's. So user_id is on every policy in both USING and WITH CHECK, and there is deliberately
-- no admin bypass - an admin has no business reading what someone privately asked to be nudged
-- about. That makes this the only table in this schema an admin cannot read, which is correct
-- and is asserted below so it cannot be softened by accident.
--
-- A reminder is one of two shapes, never both:
--   * relative  - offset_minutes before the task's due date. Follows the date if it moves.
--   * absolute  - remind_at, a fixed instant, meaningful even on a task with no due date.
-- The XOR is a CHECK constraint rather than a convention, because "both set" has no defensible
-- meaning and would silently pick one.
--
-- DELIVERY IS IDEMPOTENT, the same way 116's is. deliver_due_reminders() claims rows by stamping
-- delivered_at inside the same statement that selects them, so two overlapping runs cannot both
-- deliver one reminder. Retrying a failed job is therefore free, which is the property that lets
-- it be driven by a cron, by a page load, or by hand without any of them coordinating.
--
-- IN-APP IS THE REAL CHANNEL; EMAIL IS OPT-IN.
-- Delivery writes a row into task_notifications - which already exists (035), already has the
-- right RLS (recipient_id = auth.uid()), already has 169 rows on production and already feeds
-- the toast. A reminder is exactly what that table is for, and inventing a second inbox next to
-- it would leave a user with two places to look. Email rides on 045's existing
-- profiles.notify_email_due_soon, so the switch that has never done anything starts meaning what
-- it says: this function records who is owed an email, and the caller sends it.
--
-- SAFETY
-- Purely additive: one new table, one new function, no existing table, row, policy, grant or
-- trigger touched. --allow-prod eligible on this repo's own rule. Seeds zero reminders, so
-- applying it changes nothing anyone can see until someone sets one.
-- Rollback: scripts/rollback/117_revert.sql, which destroys reminders but no task and no
-- notification that was already delivered.

BEGIN;

CREATE TEMP TABLE _117_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)              AS task_rows,
  (SELECT count(*) FROM public.task_notifications) AS notification_rows;

CREATE TABLE IF NOT EXISTS public.task_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

  -- Whose reminder this is. Not "who it is about" - a reminder is personal, see the header.
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Exactly one of these two. See the CHECK below.
  remind_at TIMESTAMPTZ NULL,
  offset_minutes INTEGER NULL,

  channel TEXT NOT NULL DEFAULT 'in_app',

  -- Optional personal note, shown in the notification. "Ring the supplier first."
  note TEXT NULL,

  -- Stamped by deliver_due_reminders(). NOT NULL means "already fired"; it is the whole
  -- idempotency guarantee and is deliberately not writable by the client (see the grants).
  delivered_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT task_reminders_channel_check
    CHECK (channel IN ('in_app', 'email', 'both')),

  -- Exactly one shape. "Both set" would have to silently prefer one of them.
  CONSTRAINT task_reminders_shape_check
    CHECK ((remind_at IS NOT NULL) <> (offset_minutes IS NOT NULL)),

  -- Up to a full YEAR before, and never after: a reminder that fires past its own due date is
  -- a report, not a reminder. The upper bound is deliberately generous - annual compliance and
  -- renewal work genuinely wants "three months before", and the first version capped this at
  -- 60 days, which would have refused it with a raw constraint error.
  CONSTRAINT task_reminders_offset_range_check
    CHECK (offset_minutes IS NULL OR offset_minutes BETWEEN 0 AND 525600),

  -- 2000 characters. A reminder note is the sentence you leave yourself about what to actually
  -- do; there is no reason to make someone edit it down.
  CONSTRAINT task_reminders_note_length_check
    CHECK (note IS NULL OR length(note) <= 2000)
);

-- One person cannot set the same reminder on the same task twice. Two DIFFERENT people can set
-- the same one, which is the point of the table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reminders_unique_relative
  ON public.task_reminders(task_id, user_id, offset_minutes)
  WHERE offset_minutes IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reminders_unique_absolute
  ON public.task_reminders(task_id, user_id, remind_at)
  WHERE remind_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_reminders_pending
  ON public.task_reminders(delivered_at)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_reminders_user
  ON public.task_reminders(user_id, task_id);

DROP TRIGGER IF EXISTS set_task_reminders_updated_at ON public.task_reminders;
CREATE TRIGGER set_task_reminders_updated_at
  BEFORE UPDATE ON public.task_reminders
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- Grants and RLS. Personal means personal: no admin bypass anywhere below.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.task_reminders FROM PUBLIC, anon, authenticated;

-- Column-level UPDATE, not table-level. delivered_at is the idempotency stamp: a client that
-- could clear it could make one reminder fire repeatedly, and a client that could set it could
-- silence someone else's. Per 101's lesson, a column REVOKE cannot shrink a table-wide grant -
-- so the exact columns are granted and the table-wide grant is never issued.
-- INSERT is column-level too, for the same reason: a table-level INSERT grant covers EVERY
-- column, so it would let a client set delivered_at on the way in. The post-conditions below
-- caught exactly that on the first run of this migration.
GRANT SELECT, DELETE ON public.task_reminders TO authenticated;
GRANT INSERT (task_id, user_id, remind_at, offset_minutes, channel, note) ON public.task_reminders TO authenticated;
GRANT UPDATE (remind_at, offset_minutes, channel, note, updated_at) ON public.task_reminders TO authenticated;

ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;

-- Every policy is keyed on user_id = auth.uid(), and additionally requires that the person can
-- still see the task. Both halves matter: the first makes the reminder private, the second stops
-- a reminder outliving access to the work it refers to.
DROP POLICY IF EXISTS "Users can view their own reminders" ON public.task_reminders;
CREATE POLICY "Users can view their own reminders"
  ON public.task_reminders FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_reminders.task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can create their own reminders" ON public.task_reminders;
CREATE POLICY "Users can create their own reminders"
  ON public.task_reminders FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    -- can_VIEW, not can_manage: a guest who can only read a board still has every right to be
    -- reminded about work they can see. Denying that would be a capability stricter than the
    -- policy it claims to mirror, which is the defect the 2026-08-19 audit found twice.
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_reminders.task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can update their own reminders" ON public.task_reminders;
CREATE POLICY "Users can update their own reminders"
  ON public.task_reminders FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own reminders" ON public.task_reminders;
CREATE POLICY "Users can delete their own reminders"
  ON public.task_reminders FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------
-- Delivery.
--
-- SECURITY DEFINER because it stamps delivered_at (which no client may write) and inserts into
-- task_notifications on behalf of someone who is not the caller. It takes no direction from the
-- caller beyond an optional clock, so there is nothing to steer through it.
--
-- The claim and the delivery happen in ONE statement. Selecting rows and then updating them
-- would let two overlapping runs both see the same pending reminder and both deliver it; the
-- CTE below stamps delivered_at as part of the same query that reads them, so the second run
-- sees nothing to do. This is the same guarantee 116 gets from its UNIQUE constraint, reached a
-- different way because there is no natural key to collide on.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deliver_due_reminders(p_now TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (reminder_id UUID, user_id UUID, task_id UUID, task_title TEXT, wants_email BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := COALESCE(p_now, now());
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM public.task_reminders r
    JOIN public.tasks t ON t.id = r.task_id
    LEFT JOIN public.columns c ON c.id = t.column_id
    LEFT JOIN public.task_statuses s ON s.key = c.status_key
    WHERE r.delivered_at IS NULL
      AND t.deleted_at IS NULL
      AND t.archived_at IS NULL
      -- 112's category, never the raw status text. The dead reminder-service.ts filtered
      -- `status <> 'done'`, which reminds people about cancelled work and misses any board
      -- whose statuses were renamed.
      AND COALESCE(s.is_closed, FALSE) = FALSE
      AND (
        (r.remind_at IS NOT NULL AND r.remind_at <= v_now)
        OR (
          r.offset_minutes IS NOT NULL
          AND t.due_date IS NOT NULL
          AND (t.due_date - make_interval(mins => r.offset_minutes)) <= v_now
          -- A relative reminder whose due date has already passed is not delivered: the task is
          -- overdue, which is a different message, and firing "due in 1 day" a week late is
          -- worse than staying quiet.
          AND t.due_date >= v_now
        )
      )
    ORDER BY r.created_at
    -- A ceiling on one sweep, not on the feature. Anything beyond it is picked up by the next
    -- run, because delivery is idempotent - so the only cost of hitting this is latency, never
    -- a lost reminder. 5000 is far beyond what this workspace can generate in a day; it exists
    -- so a runaway import cannot turn one cron invocation into a timeout.
    LIMIT 5000
  ),
  claimed AS (
    -- The claim and the read are the same statement. See the header.
    UPDATE public.task_reminders r
    SET delivered_at = v_now
    FROM due
    WHERE r.id = due.id AND r.delivered_at IS NULL
    RETURNING r.id, r.user_id, r.task_id, r.note, r.channel
  ),
  noted AS (
    INSERT INTO public.task_notifications (recipient_id, task_id, actor_id, type, message)
    SELECT
      c.user_id,
      c.task_id,
      NULL,
      'reminder',
      COALESCE(NULLIF(c.note, ''), 'Reminder: ' || t.title)
    FROM claimed c
    JOIN public.tasks t ON t.id = c.task_id
    WHERE c.channel IN ('in_app', 'both')
    RETURNING 1
  )
  SELECT
    c.id,
    c.user_id,
    c.task_id,
    t.title,
    -- Email is owed only when the reminder asked for it AND 045's standing preference allows
    -- it. Sending is the caller's job; this function records who is owed one.
    (c.channel IN ('email', 'both') AND COALESCE(p.notify_email_due_soon, TRUE))
  FROM claimed c
  JOIN public.tasks t ON t.id = c.task_id
  LEFT JOIN public.profiles p ON p.id = c.user_id
  -- Force the INSERT CTE to run even when no row wants an in-app notification.
  WHERE (SELECT count(*) FROM noted) >= 0;
END;
$$;

-- ⚠️ FROM PUBLIC alone leaves this callable. See 116's matching note: `postgres` holds a
-- DEFAULT ACL granting EXECUTE on every new function in `public` to `authenticated`, which is
-- a real grant that REVOKE ... FROM PUBLIC does not remove.
--
-- Leaving it open would be a disclosure, not just untidiness: this function is SECURITY
-- DEFINER, sweeps EVERY user's reminders, and RETURNS their user ids, task titles and whether
-- they are owed an email. Any signed-in user could call it and read the lot, on a table whose
-- entire design is that reminders are private. Only the scheduled job (service_role) may.
REVOKE ALL ON FUNCTION public.deliver_due_reminders(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- The same delivery, scoped to the caller.
--
-- This exists because the Vercel project is on the Hobby plan, where cron jobs run at most
-- ONCE A DAY. A daily sweep is fine for "1 day before" and useless for "30 minutes before",
-- and shipping a 30-minute option that silently fires up to 24 hours late would be exactly
-- the kind of control-wired-to-nothing this migration was written to end.
--
-- So the app calls this while it is open, delivering only the signed-in user's own due
-- reminders. It is safe to expose precisely because it can see nothing else: the WHERE clause
-- is auth.uid() and there is no parameter to widen it. Same claim-and-read statement, so it
-- stays idempotent and cannot race the nightly sweep.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deliver_my_due_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_me  UUID := auth.uid();
  v_count INTEGER := 0;
BEGIN
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;

  WITH due AS (
    SELECT r.id
    FROM public.task_reminders r
    JOIN public.tasks t ON t.id = r.task_id
    LEFT JOIN public.columns c ON c.id = t.column_id
    LEFT JOIN public.task_statuses s ON s.key = c.status_key
    WHERE r.user_id = v_me
      AND r.delivered_at IS NULL
      AND t.deleted_at IS NULL
      AND t.archived_at IS NULL
      AND COALESCE(s.is_closed, FALSE) = FALSE
      AND (
        (r.remind_at IS NOT NULL AND r.remind_at <= v_now)
        OR (
          r.offset_minutes IS NOT NULL
          AND t.due_date IS NOT NULL
          AND (t.due_date - make_interval(mins => r.offset_minutes)) <= v_now
          AND t.due_date >= v_now
        )
      )
    -- Same reasoning as the full sweep's ceiling: a bound on one call, not on the feature.
    -- This one runs from a browser every five minutes, so the remainder is never far behind.
    LIMIT 1000
  ),
  claimed AS (
    UPDATE public.task_reminders r
    SET delivered_at = v_now
    FROM due
    WHERE r.id = due.id AND r.delivered_at IS NULL
    RETURNING r.id, r.user_id, r.task_id, r.note, r.channel
  ),
  noted AS (
    INSERT INTO public.task_notifications (recipient_id, task_id, actor_id, type, message)
    SELECT c.user_id, c.task_id, NULL, 'reminder',
           COALESCE(NULLIF(c.note, ''), 'Reminder: ' || t.title)
    FROM claimed c
    JOIN public.tasks t ON t.id = c.task_id
    WHERE c.channel IN ('in_app', 'both')
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_count FROM claimed;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.deliver_my_due_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliver_my_due_reminders() TO authenticated;

COMMENT ON TABLE public.task_reminders IS
  'Per-user reminders on a task. A reminder belongs to a PERSON, not to the task - two people '
  'can watch the same task at different warning times and neither can see the other''s. '
  'No admin bypass exists on any policy here, deliberately.';
COMMENT ON COLUMN public.task_reminders.delivered_at IS
  'Stamped by deliver_due_reminders() inside the same statement that selects the row, which is '
  'what makes delivery idempotent. Not writable by any client role.';

-- ---------------------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before BIGINT;
  v_after  BIGINT;
  v_bad    BIGINT;
BEGIN
  SELECT task_rows INTO v_before FROM _117_precheck;
  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'tasks row count changed during an additive migration (% -> %). Aborting.', v_before, v_after;
  END IF;

  SELECT notification_rows INTO v_before FROM _117_precheck;
  SELECT count(*) INTO v_after FROM public.task_notifications;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'task_notifications changed (% -> %) - this migration must deliver nothing. Aborting.', v_before, v_after;
  END IF;

  SELECT count(*) INTO v_bad FROM public.task_reminders;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'The migration seeded % reminder(s). It must seed none. Aborting.', v_bad;
  END IF;

  -- delivered_at must not be writable by a client, or idempotency is a suggestion.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'task_reminders'
      AND column_name = 'delivered_at' AND grantee IN ('authenticated', 'anon')
      AND privilege_type IN ('UPDATE', 'INSERT')
  ) THEN
    RAISE EXCEPTION 'authenticated can write task_reminders.delivered_at - delivery would not be idempotent. Aborting.';
  END IF;

  -- Per 101: a table-wide UPDATE grant silently defeats the column-level one above.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'task_reminders'
      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated holds a TABLE-WIDE UPDATE on task_reminders, which overrides the column grant. Aborting.';
  END IF;

  SELECT count(*) INTO v_bad FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'task_reminders' AND grantee = 'anon';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on task_reminders - 095 must stay closed. Aborting.', v_bad;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.task_reminders'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on task_reminders. Aborting.';
  END IF;

  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'task_reminders';
  IF v_bad <> 4 THEN
    RAISE EXCEPTION 'Expected 4 policies on task_reminders, found %. Aborting.', v_bad;
  END IF;

  -- Every policy must be keyed on the owner. An admin bypass here would let an admin read what
  -- someone privately asked to be nudged about; see the header.
  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'task_reminders'
    AND COALESCE(qual, with_check) NOT LIKE '%auth.uid()%';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% policy on task_reminders is not keyed on auth.uid(). Aborting.', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_reminders'
      AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%is_admin_user%'
  ) THEN
    RAISE EXCEPTION 'A task_reminders policy grants admin access. Reminders are private. Aborting.';
  END IF;

  -- The full sweep must not be reachable by a client: it returns every user's reminder data.
  IF has_function_privilege('authenticated', 'public.deliver_due_reminders(timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.deliver_due_reminders(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'deliver_due_reminders is callable by a client role - it would disclose every user''s reminders. Aborting.';
  END IF;

  -- The scoped one must be reachable, or sub-day reminders never fire on this hosting plan.
  IF NOT has_function_privilege('authenticated', 'public.deliver_my_due_reminders()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot deliver their own reminders. Aborting.';
  END IF;
  IF has_function_privilege('anon', 'public.deliver_my_due_reminders()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can call deliver_my_due_reminders. Aborting.';
  END IF;

  -- 112 is a hard dependency: delivery decides open vs closed by category.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND column_name = 'is_closed'
  ) THEN
    RAISE EXCEPTION '112 has not been applied - delivery cannot tell an open task from a closed one. Aborting.';
  END IF;

  -- 045 is a hard dependency: the email half reads its preference column.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'notify_email_due_soon'
  ) THEN
    RAISE EXCEPTION '045 has not been applied - there is no email preference to honour. Aborting.';
  END IF;

  RAISE NOTICE '117 verified: task_reminders created private, delivered_at unwritable, 0 seeded, 0 delivered.';
END $$;

COMMIT;
