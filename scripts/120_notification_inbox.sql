-- 120: turn task_notifications into an inbox, and give a person control over what lands in it.
--
-- WHY THERE IS NO NEW NOTIFICATIONS TABLE
-- `task_notifications` already exists (035), already has the right RLS (recipient_id =
-- auth.uid() on SELECT and UPDATE), already has four writers in the app and 169 rows on
-- production, and 117 already delivers personal reminders into it. An inbox is exactly what
-- that table is for. Building a second one next to it would leave every user with two places
-- to look and two unread counts that disagree - the same mistake 117 refused for reminders.
--
-- So this migration adds what an inbox needs and nothing else:
--
--   snoozed_until  - "not now, ask me later". A per-notification timestamp the recipient
--                    writes themselves; the existing UPDATE policy already permits it.
--   entity_type    - what the notification is really about, when that is narrower than the
--   entity_id        task: a comment, a custom field, a relation. This is what makes
--                    "open the exact context" possible instead of dropping the reader on the
--                    task and letting them hunt.
--
-- ⚠️ NO STORED LINK PATH, DELIBERATELY. The obvious alternative is one `link` TEXT column, and
-- it is wrong in this repo specifically: a board lives at BOTH /admin/board/<id> and
-- /dashboard/board/<id>, and which one a person must be sent to is a function of their own
-- role, not of the notification (see boardHref in components/shell/workspace-nav.ts, and the
-- five hrefs that got this wrong in 2026-08-21). A path baked in at write time would pin every
-- reader into whichever surface the writer happened to be on. The client composes the href.
--
-- WHAT CLASSIFICATION IS *NOT* HERE
-- The Action Required / Updates split is a function of `type`, and it lives in
-- lib/notifications.ts as a plain map rather than in a lookup table. A table would buy
-- nothing today - no query filters on the category server-side, nothing writes it, and no
-- screen edits it - and this repo has a standing rule against building the extensibility
-- before anything needs it (see team_members.team_role). When a server-side digest needs to
-- group by category, that is the day the table earns itself.
--
-- FOLLOW AND MUTE
-- Two small tables rather than one polymorphic (scope_type, scope_id) table, because a
-- polymorphic scope cannot carry a foreign key, and a subscription pointing at a board that
-- no longer exists is exactly the orphan-row problem marketing_calendar_items.channel is
-- still paying for.
--
--   task_follows  - state 'following' (send me this task's traffic even though it is not
--                   mine) or 'muted' (keep it out of my inbox).
--   board_mutes   - "mute project". There is no board_follows: following a whole board would
--                   mean generating notifications nothing currently generates, and a control
--                   wired to nothing is this codebase's most-repeated defect (profiles.is_active,
--                   app_modules, board_members.role). Muting is enforceable today; following a
--                   board is not, so it is not offered.
--
-- ⚠️ MUTE IS ENFORCED AT READ, FOLLOW AT WRITE, and that asymmetry is intentional. Follow can
-- only work at write time - there is no row to reveal later if it was never created. Mute must
-- work at read time, because the writers are ordinary client code and a mute that depended on
-- every writer remembering to check would be a mute that leaks. Read-time also makes unmuting
-- restore the history instead of having silently destroyed it.
--
-- DEPROVISIONING (asked at creation, per the rule 119 learned the hard way)
-- Both new tables are ON DELETE CASCADE on user_id, and that is the right answer here rather
-- than a reassignment: a follow or a mute is one person's private preference, visible to
-- nobody else, so deleting the person destroys nothing anyone can see. Neither table needs a
-- line in app/api/admin/delete-user/route.ts. task_id/board_id also cascade: a preference
-- about work that no longer exists is not worth keeping.
--
-- SAFETY
-- Additive. Three nullable columns on task_notifications (no default, no rewrite, no existing
-- row changed), two brand-new tables, no existing table, policy, grant or trigger touched.
-- --allow-prod eligible on this repo's own rule. Seeds zero rows, so applying it changes
-- nothing anyone can see until someone snoozes, follows or mutes something.
-- Rollback: scripts/rollback/120_revert.sql.

BEGIN;

CREATE TEMP TABLE _120_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)              AS task_rows,
  (SELECT count(*) FROM public.boards)             AS board_rows,
  (SELECT count(*) FROM public.task_notifications) AS notification_rows,
  (SELECT count(*) FROM public.task_notifications WHERE read_at IS NULL) AS unread_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

-- ---------------------------------------------------------------------------------------
-- Inbox columns on the notification row itself.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.task_notifications
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entity_type   TEXT,
  ADD COLUMN IF NOT EXISTS entity_id     UUID;

COMMENT ON COLUMN public.task_notifications.snoozed_until IS
  'Hide this notification from the inbox until this instant. Written by the recipient; the '
  'existing "Users can update own task notifications" policy already scopes it to them.';
COMMENT ON COLUMN public.task_notifications.entity_type IS
  'What the notification is really about, when narrower than the task: comment, field, '
  'relation. Used to compose a deep link at read time - the path itself is never stored, '
  'because which board route a person may open depends on their role, not on this row.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_notifications_entity_type_check'
      AND conrelid = 'public.task_notifications'::regclass
  ) THEN
    -- Every existing row has NULL in both columns, so this validates instantly and cannot
    -- reject anything already stored.
    ALTER TABLE public.task_notifications
      ADD CONSTRAINT task_notifications_entity_type_check
      CHECK (entity_type IS NULL OR entity_type IN ('task', 'comment', 'field', 'relation', 'approval', 'request'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_notifications_entity_pair_check'
      AND conrelid = 'public.task_notifications'::regclass
  ) THEN
    -- An id with no type cannot be resolved to anything, so it is not a deep link, it is a
    -- uuid nobody can use.
    ALTER TABLE public.task_notifications
      ADD CONSTRAINT task_notifications_entity_pair_check
      CHECK (entity_id IS NULL OR entity_type IS NOT NULL);
  END IF;
END $$;

-- The inbox's own query: one recipient, unread first, newest first. read_at is already in
-- 035's index; snoozed_until is what this screen adds to the predicate.
CREATE INDEX IF NOT EXISTS idx_task_notifications_inbox
  ON public.task_notifications(recipient_id, snoozed_until, created_at DESC);

-- ---------------------------------------------------------------------------------------
-- Follow / mute a work item.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_follows (
  task_id    UUID NOT NULL REFERENCES public.tasks(id)    ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT task_follows_state_check CHECK (state IN ('following', 'muted')),
  PRIMARY KEY (task_id, user_id)
);

COMMENT ON TABLE public.task_follows IS
  'One person''s relationship to one work item''s notification traffic. "following" adds them '
  'as a recipient of updates they would not otherwise get; "muted" keeps that item out of '
  'their inbox. Private to the user - no admin may read it.';

CREATE INDEX IF NOT EXISTS idx_task_follows_user_state ON public.task_follows(user_id, state);

-- ---------------------------------------------------------------------------------------
-- Mute a project.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_mutes (
  board_id   UUID NOT NULL REFERENCES public.boards(id)   ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (board_id, user_id)
);

COMMENT ON TABLE public.board_mutes IS
  'Boards whose notifications this person does not want in their inbox. Read-time filter, so '
  'unmuting brings the history back rather than having destroyed it. Private to the user.';

CREATE INDEX IF NOT EXISTS idx_board_mutes_user ON public.board_mutes(user_id);

-- ---------------------------------------------------------------------------------------
-- Grants and RLS.
--
-- Supabase's default privileges hand every new table in public a blanket ALL to anon and
-- authenticated, so granting narrowly is not enough - the wide grant is already there and has
-- to be revoked first (090's lesson, and 095 closed the anon half globally but a table created
-- through the dashboard still inherits it, so this stays explicit).
--
-- ⚠️ NO ADMIN BYPASS ON ANY POLICY HERE, and the post-conditions assert it stays that way.
-- What a person has chosen to mute is a statement about their own attention. It is the same
-- rule 117 applied to task_reminders and 119 to personal saved views.
--
-- INSERT additionally requires the task/board to be visible, expressed as a bare EXISTS. That
-- reads as "the row exists", and it means "you can see it": a policy expression runs as the
-- table owner, but RLS on the tables it *reads* still applies to the caller, so tasks' and
-- boards' own SELECT policies do the work. Nothing here has to know about board privacy,
-- guest roles or task visibility, and it cannot drift from them (109's note, used the safe way
-- round: the subquery only ever needs rows the caller may already read).
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.task_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_mutes  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.task_follows FROM anon;
REVOKE ALL ON public.task_follows FROM authenticated;
REVOKE ALL ON public.board_mutes  FROM anon;
REVOKE ALL ON public.board_mutes  FROM authenticated;

-- UPDATE is granted on task_follows and not on board_mutes, because one has an editable
-- column and the other does not: a follow flips between following and muted in place (one
-- upsert, so the row cannot briefly not exist), while a mute is only ever on or off.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_follows TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.board_mutes  TO authenticated;

DROP POLICY IF EXISTS "Users read their own task follows" ON public.task_follows;
CREATE POLICY "Users read their own task follows"
  ON public.task_follows FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users follow tasks they can see" ON public.task_follows;
CREATE POLICY "Users follow tasks they can see"
  ON public.task_follows FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_follows.task_id)
  );

DROP POLICY IF EXISTS "Users change their own task follows" ON public.task_follows;
CREATE POLICY "Users change their own task follows"
  ON public.task_follows FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users drop their own task follows" ON public.task_follows;
CREATE POLICY "Users drop their own task follows"
  ON public.task_follows FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read their own board mutes" ON public.board_mutes;
CREATE POLICY "Users read their own board mutes"
  ON public.board_mutes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users mute boards they can see" ON public.board_mutes;
CREATE POLICY "Users mute boards they can see"
  ON public.board_mutes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_mutes.board_id)
  );

DROP POLICY IF EXISTS "Users unmute their own boards" ON public.board_mutes;
CREATE POLICY "Users unmute their own boards"
  ON public.board_mutes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------
-- Post-conditions. Anything false here rolls the whole migration back.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks         BIGINT;
  v_before_boards        BIGINT;
  v_before_notifications BIGINT;
  v_before_unread        BIGINT;
  v_count                BIGINT;
  v_qual                 TEXT;
  v_task                 UUID;
  v_user                 UUID;
BEGIN
  SELECT task_rows, board_rows, notification_rows, unread_rows
    INTO v_before_tasks, v_before_boards, v_before_notifications, v_before_unread
  FROM _120_precheck;

  IF (SELECT count(*) FROM public.tasks) <> v_before_tasks THEN
    RAISE EXCEPTION 'Task row count moved. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.boards) <> v_before_boards THEN
    RAISE EXCEPTION 'Board row count moved. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.task_notifications) <> v_before_notifications THEN
    RAISE EXCEPTION 'Notification row count moved. Aborting.';
  END IF;

  -- The one thing a badly written inbox migration would quietly destroy: everyone's backlog
  -- of unread notifications, by "helpfully" marking the old ones read.
  IF (SELECT count(*) FROM public.task_notifications WHERE read_at IS NULL) <> v_before_unread THEN
    RAISE EXCEPTION 'Unread notification count moved from % - this migration must not read anyone''s mail. Aborting.', v_before_unread;
  END IF;

  IF (SELECT count(*) FROM public.task_notifications WHERE snoozed_until IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'Something was seeded as snoozed. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.task_follows) <> 0 THEN
    RAISE EXCEPTION 'task_follows was seeded. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.board_mutes) <> 0 THEN
    RAISE EXCEPTION 'board_mutes was seeded. Aborting.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.task_follows'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on task_follows. Aborting.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.board_mutes'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on board_mutes. Aborting.';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('task_follows', 'board_mutes') AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on the new tables. Aborting.', v_count;
  END IF;

  -- A mute list is private. If an admin term ever appears in either SELECT policy this fails
  -- loudly rather than quietly widening.
  FOR v_qual IN
    SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('task_follows', 'board_mutes') AND cmd = 'SELECT'
  LOOP
    IF v_qual LIKE '%is_admin_user%' OR v_qual LIKE '%is_super_admin_user%' THEN
      RAISE EXCEPTION 'A follow/mute SELECT policy has an admin bypass. These are private. Aborting.';
    END IF;
  END LOOP;

  -- "The constraint exists" and "the constraint refuses this" are different claims (117).
  SELECT id INTO v_task FROM public.tasks LIMIT 1;
  SELECT id INTO v_user FROM public.profiles LIMIT 1;
  IF v_task IS NOT NULL AND v_user IS NOT NULL THEN
    BEGIN
      INSERT INTO public.task_follows (task_id, user_id, state) VALUES (v_task, v_user, 'shouting');
      RAISE EXCEPTION 'An unknown follow state was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And a good one must be accepted, or the constraint is simply refusing everything.
    INSERT INTO public.task_follows (task_id, user_id, state) VALUES (v_task, v_user, 'muted');
    DELETE FROM public.task_follows WHERE task_id = v_task AND user_id = v_user;
  END IF;

  BEGIN
    INSERT INTO public.task_notifications (recipient_id, task_id, type, message, entity_type)
    SELECT id, NULL, 'update', '_120_probe', 'nonsense' FROM public.profiles LIMIT 1;
    RAISE EXCEPTION 'An unknown entity_type was accepted. Aborting.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.task_notifications (recipient_id, task_id, type, message, entity_id)
    SELECT id, NULL, 'update', '_120_probe', gen_random_uuid() FROM public.profiles LIMIT 1;
    RAISE EXCEPTION 'An entity id with no entity type was accepted. Aborting.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF (SELECT count(*) FROM public.task_notifications) <> v_before_notifications THEN
    RAISE EXCEPTION 'A probe notification survived. Aborting.';
  END IF;

  RAISE NOTICE '120 verified: inbox columns on task_notifications, task_follows + board_mutes, no admin bypass, % notifications untouched (% unread).', v_before_notifications, v_before_unread;
END $$;

COMMIT;
