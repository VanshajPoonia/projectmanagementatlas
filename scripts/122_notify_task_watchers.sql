-- 122: fan a notification out to everyone watching a work item.
--
-- WHY A FUNCTION AND NOT A CLIENT-SIDE QUERY
-- 120 made `task_follows` private: its SELECT policy is `user_id = auth.uid()` with no admin
-- bypass, because what a person has chosen to follow or mute is a statement about their own
-- attention. That is the right rule and it has a consequence - **the person writing a comment
-- cannot see who follows the task**. A client that asked would get back its own row and
-- nothing else, and would conclude the task has no followers.
--
-- That is this repo's most-repeated trap arriving from a new direction: "hidden from you" and
-- "does not exist" come back looking identical, and code that treats the empty list as a fact
-- about the world is wrong for exactly the users the policy was written to protect. The
-- documented answer is a SECURITY DEFINER function that resolves the question past RLS and
-- returns the narrowest possible answer - here, a count. The follower list never leaves the
-- database.
--
-- WHO GETS NOTIFIED
--   every assignee (task_assignees, plus the legacy tasks.assigned_to)
--   + everyone who explicitly followed the task
--   - the person who did the thing
--   - anyone deactivated (101: is_active is real now; mail to a banned account is litter)
--
-- ⚠️ MUTED PEOPLE ARE STILL INCLUDED, deliberately. Muting is enforced when the inbox is READ
-- (lib/notifications.ts::isMuted), not when the notification is written, so that unmuting
-- brings the history back instead of having silently destroyed it. Filtering here would make
-- the two halves of one feature disagree about what "muted" means.
--
-- WHO MAY CALL IT
-- Anyone who can VIEW the task - not manage it. That is wider than the table's own INSERT
-- policy (035, which requires can_manage_task) and it is deliberate: a guest or client may
-- comment on a board they can read (the task_comments INSERT policy keys off can_view_task,
-- and lib/capabilities.ts was corrected in 2026-08-19 for being stricter than that policy),
-- and a comment nobody is told about is not a conversation. The caller cannot choose the
-- recipients, cannot forge the actor, and cannot reach a task they cannot see.
--
-- ⚠️ GRANTS ARE STATED AND ASSERTED, NOT ASSUMED. `postgres` carries a default ACL granting
-- EXECUTE on every new function in public to `authenticated`, which `REVOKE ... FROM PUBLIC`
-- does not touch - 117 shipped two SECURITY DEFINER functions to dev with that hole before
-- has_function_privilege() was actually queried rather than reasoned about.
--
-- SAFETY
-- Purely additive: one new function. No existing table, column, row, policy, grant or trigger
-- is touched, so this is --allow-prod eligible on this repo's own rule. It creates no
-- notification until something calls it.
-- Rollback: scripts/rollback/122_revert.sql.
--
-- Depends on 120 (task_follows). Apply 120 first.

BEGIN;

CREATE TEMP TABLE _122_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.task_notifications) AS notification_rows,
  (SELECT count(*) FROM public.tasks)              AS task_rows;

CREATE OR REPLACE FUNCTION public.notify_task_watchers(
  p_task_id     UUID,
  p_type        TEXT,
  p_message     TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  IF p_message IS NULL OR btrim(p_message) = '' THEN
    RAISE EXCEPTION 'A notification needs a message.' USING ERRCODE = '22023';
  END IF;

  -- Long enough for a quoted comment, short enough that this cannot be used to store data.
  IF length(p_message) > 2000 THEN
    RAISE EXCEPTION 'Notification message is too long (% characters, limit 2000).', length(p_message)
      USING ERRCODE = '22001';
  END IF;

  -- The authority check. This runs as the definer, so RLS on `tasks` does not apply - which is
  -- exactly why the visibility rule is called explicitly rather than left to a policy that is
  -- not in force here.
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
  ) THEN
    RAISE EXCEPTION 'That work item is not available to you.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.task_notifications
    (recipient_id, task_id, actor_id, type, message, entity_type, entity_id)
  SELECT DISTINCT w.user_id, p_task_id, v_actor, p_type, p_message, p_entity_type, p_entity_id
  FROM (
      SELECT ta.user_id FROM public.task_assignees ta WHERE ta.task_id = p_task_id
      UNION
      SELECT t.assigned_to FROM public.tasks t WHERE t.id = p_task_id AND t.assigned_to IS NOT NULL
      UNION
      SELECT tf.user_id FROM public.task_follows tf
       WHERE tf.task_id = p_task_id AND tf.state = 'following'
  ) w
  JOIN public.profiles p ON p.id = w.user_id AND p.is_active
  WHERE w.user_id IS NOT NULL
    AND w.user_id <> v_actor;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.notify_task_watchers(UUID, TEXT, TEXT, TEXT, UUID) IS
  'Notify a work item''s assignees and explicit followers, excluding the caller and anyone '
  'deactivated. SECURITY DEFINER because task_follows is private to each user, so the caller '
  'cannot see who follows the task; returns a count and never the list. Muted recipients are '
  'included on purpose - muting is applied when the inbox is read.';

-- The default ACL is the trap, not PUBLIC. Both are revoked, then exactly one role is granted.
REVOKE ALL ON FUNCTION public.notify_task_watchers(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_task_watchers(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_notifications BIGINT;
  v_before_tasks         BIGINT;
BEGIN
  SELECT notification_rows, task_rows INTO v_before_notifications, v_before_tasks FROM _122_precheck;

  IF (SELECT count(*) FROM public.task_notifications) <> v_before_notifications THEN
    RAISE EXCEPTION 'Notification row count moved. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.tasks) <> v_before_tasks THEN
    RAISE EXCEPTION 'Task row count moved. Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_task_watchers' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'notify_task_watchers is missing or is not SECURITY DEFINER. Aborting.';
  END IF;

  -- Asserted, not assumed - see the header.
  IF has_function_privilege('anon', 'public.notify_task_watchers(uuid,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute notify_task_watchers. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.notify_task_watchers(uuid,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute notify_task_watchers, so nothing can notify anyone. Aborting.';
  END IF;

  -- Called with no session, it must refuse rather than notify the world. "The check exists"
  -- and "the check refuses this" are different claims (117).
  BEGIN
    PERFORM public.notify_task_watchers(gen_random_uuid(), 'update', '_122_probe');
    RAISE EXCEPTION 'notify_task_watchers ran without a signed-in caller. Aborting.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT count(*) FROM public.task_notifications) <> v_before_notifications THEN
    RAISE EXCEPTION 'A probe notification survived. Aborting.';
  END IF;

  RAISE NOTICE '122 verified: notify_task_watchers is definer-only, anon revoked, % notifications untouched.',
    v_before_notifications;
END $$;

COMMIT;
