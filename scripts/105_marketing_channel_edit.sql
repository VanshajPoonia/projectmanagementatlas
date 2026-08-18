-- 105: let the marketing calendar's channel columns be RENAMED and switched off/on,
-- not only reordered.
--
-- WHY THIS EXISTS
-- 054 created marketing_channels with a `label` (what the grid header shows) and an
-- `is_archived` flag (what hides a column), and 055 narrowed the write policies to:
--
--     UPDATE / DELETE  USING (EXISTS (SELECT 1 FROM profiles
--                                     WHERE id = auth.uid() AND role = 'admin'))
--
-- with an explicit comment: "keep renaming/archiving admin-only since there's no UI for
-- that yet". Two years of nothing later, that is still true — `label` and `is_archived`
-- are columns no screen can write. A channel typed wrong at creation is permanent, and a
-- channel the company has stopped posting to sits in the grid forever taking a column's
-- width. This is the guest/client lesson from CLAUDE.md a fourth time: the flag exists,
-- the policy exists, and no human can reach either.
--
-- WHY AN RPC RATHER THAN WIDENING THE POLICY — two separate reasons.
--
-- 1. That policy says `role = 'admin'` LITERALLY, which EXCLUDES super_admin. Bobby and
--    Kayla, the only two people who actually run this calendar, are both super_admin. So
--    the "admin-only" path 055 left in place has never been reachable by either of them:
--    every rename they attempted would have returned 0 rows and no error. This is exactly
--    what 088 hit for ordering, and the same fix applies.
--
-- 2. marketing_calendar_items.channel stores the channel as TEXT with no foreign key, so
--    a bare UPDATE of marketing_channels.channel orphans every event pointing at the old
--    string — they vanish from the grid with no error and no way to find them. A rename is
--    therefore not one write, it is two that must not be separable. That is a transaction,
--    which is a function, not a policy. `label` alone could have been a widened policy;
--    doing both through one door keeps "rename this channel" a single concept.
--
-- WHO MAY DO IT
-- private.can_manage_marketing_channels() = an admin (is_admin_user, so admin AND
-- super_admin, and 101's is_active is folded in there), OR any active member of at least
-- one marketing calendar. That is deliberately the same set as
-- `canUseMarketingCalendar` in components/user/user-dashboard.tsx — the people who can see
-- the tab are the people who can maintain its columns. It is narrower than 055's INSERT
-- policy ("any authenticated user can add a channel"), which is left exactly as it is:
-- adding a column nobody uses is untidy, renaming one retitles 337 existing events.
--
-- WHAT THIS DOES NOT CHANGE
-- No policy on marketing_channels is touched, so the direct-UPDATE path stays literal-admin
-- only and DELETE stays admin-only — deleting a channel would still orphan its events, and
-- archiving is the reversible answer to "turn this off". 088's reorder RPC is untouched.

BEGIN;

CREATE TEMP TABLE _105_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.marketing_channels)       AS channel_rows,
  (SELECT count(*) FROM public.marketing_calendar_items) AS item_rows,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketing_channels') AS policy_rows;

-- ---------------------------------------------------------------------------
-- 1. Who may maintain the shared channel list.
--
-- SECURITY DEFINER + STABLE, matching private.is_calendar_member (085): the
-- membership read has to see rows the caller's own RLS would filter, and the
-- planner should be free to call it once per statement.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.can_manage_marketing_channels()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT private.is_admin_user()
      OR EXISTS (
        SELECT 1
        FROM public.marketing_calendar_members mm
        JOIN public.profiles p ON p.id = mm.user_id
        WHERE mm.user_id = auth.uid()
          AND COALESCE(p.is_active, true)
      );
$$;

REVOKE ALL ON FUNCTION private.can_manage_marketing_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_manage_marketing_channels() TO authenticated;

COMMENT ON FUNCTION private.can_manage_marketing_channels() IS
  'True for an admin/super_admin or an active member of any marketing calendar. Mirrors '
  'canUseMarketingCalendar in the dashboard: whoever can see the tab can maintain its columns.';

-- ---------------------------------------------------------------------------
-- 2. Rename. The channel value and its display label move together with every
--    event that points at the old value, in one transaction.
--
--    p_channel is the stored value (marketing_calendar_items.channel), p_label
--    is the grid header. The UI keeps them equal for channels a user creates;
--    the seeded rows deliberately differ ("FB - Bobby" / "FB Bobby"), so both
--    are parameters rather than one derived from the other.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rename_marketing_channel(
  p_channel_id uuid,
  p_channel    text,
  p_label      text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_channel text;
  v_channel     text := btrim(coalesce(p_channel, ''));
  v_label       text := btrim(coalesce(p_label, ''));
  v_items       integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT private.can_manage_marketing_channels() THEN
    RAISE EXCEPTION 'You do not have permission to edit marketing channels.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_channel = '' THEN
    RAISE EXCEPTION 'A channel needs a name.' USING ERRCODE = 'check_violation';
  END IF;

  -- An empty label would render a blank column header, which is indistinguishable
  -- from a rendering bug. Fall back to the channel value rather than refusing.
  IF v_label = '' THEN
    v_label := v_channel;
  END IF;

  -- FOR UPDATE so two people renaming the same channel at once serialise here rather
  -- than racing between the duplicate check below and the UPDATE.
  SELECT channel INTO v_old_channel
  FROM public.marketing_channels
  WHERE id = p_channel_id
  FOR UPDATE;

  IF v_old_channel IS NULL THEN
    RAISE EXCEPTION 'That channel no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  -- 057 put a UNIQUE index on lower(channel). Checking it here turns a raw 23505 into a
  -- sentence, and catches the case-only collision ("blog" vs "BLOG") the index would too.
  IF EXISTS (
    SELECT 1 FROM public.marketing_channels
    WHERE lower(channel) = lower(v_channel) AND id <> p_channel_id
  ) THEN
    RAISE EXCEPTION 'Another channel is already called "%".', v_channel
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE public.marketing_channels
     SET channel = v_channel,
         label   = v_label
   WHERE id = p_channel_id;

  -- The half that has no foreign key to do it. Skipped when only the label changed, so a
  -- label-only edit does not rewrite 337 rows to the values they already hold.
  IF v_old_channel IS DISTINCT FROM v_channel THEN
    UPDATE public.marketing_calendar_items
       SET channel = v_channel
     WHERE channel = v_old_channel;
    GET DIAGNOSTICS v_items = ROW_COUNT;
  END IF;

  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_marketing_channel(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_marketing_channel(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_marketing_channel(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.rename_marketing_channel(uuid, text, text) IS
  'Renames a marketing channel and re-points every calendar event that referenced it, in one '
  'transaction. Returns the number of events moved. The only rename path that cannot orphan them.';

-- ---------------------------------------------------------------------------
-- 3. Off / on. Archiving hides the column for everyone and keeps its events,
--    which is what "turn this channel off" has to mean when the events are
--    joined by a text value: DELETE would strand them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_marketing_channel_archived(
  p_channel_id uuid,
  p_archived   boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
  v_items   integer;
  v_rows    integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT private.can_manage_marketing_channels() THEN
    RAISE EXCEPTION 'You do not have permission to edit marketing channels.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'An on/off value is required.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT channel INTO v_channel
  FROM public.marketing_channels
  WHERE id = p_channel_id
  FOR UPDATE;

  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'That channel no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.marketing_channels
     SET is_archived = p_archived
   WHERE id = p_channel_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'That channel could not be updated.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Returned so the caller can say "hidden, 53 scheduled posts kept" instead of leaving the
  -- user to guess whether switching a column off threw its content away.
  SELECT count(*)::integer INTO v_items
  FROM public.marketing_calendar_items
  WHERE channel = v_channel;

  RETURN v_items;
END;
$$;

REVOKE ALL ON FUNCTION public.set_marketing_channel_archived(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_marketing_channel_archived(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_marketing_channel_archived(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_marketing_channel_archived(uuid, boolean) IS
  'Switches a marketing channel column off (archived) or back on. Returns how many calendar '
  'events are on that channel, so the caller can report what was hidden rather than deleted.';

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before_channels bigint;
  v_before_items    bigint;
  v_before_policies bigint;
  v_after           bigint;
BEGIN
  -- The functions exist with the exact signatures the client will call.
  IF to_regprocedure('public.rename_marketing_channel(uuid, text, text)') IS NULL
     OR to_regprocedure('public.set_marketing_channel_archived(uuid, boolean)') IS NULL
     OR to_regprocedure('private.can_manage_marketing_channels()') IS NULL THEN
    RAISE EXCEPTION 'A function this migration creates is missing. Aborting.';
  END IF;

  -- 095's lesson: CREATE FUNCTION grants EXECUTE to PUBLIC implicitly, and anon inherits it.
  IF has_function_privilege('anon', 'public.rename_marketing_channel(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_marketing_channel_archived(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute a channel-editing function. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rename_marketing_channel(uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_marketing_channel_archived(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute a channel-editing function. Aborting.';
  END IF;

  -- This migration must not touch the table's own protection: the direct-write path stays
  -- exactly as 055 left it, and RLS stays on.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.marketing_channels'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on marketing_channels. Aborting.';
  END IF;

  SELECT channel_rows, item_rows, policy_rows
    INTO v_before_channels, v_before_items, v_before_policies
  FROM _105_precheck;

  SELECT count(*) INTO v_after FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'marketing_channels';
  IF v_after IS DISTINCT FROM v_before_policies THEN
    RAISE EXCEPTION 'marketing_channels policy count changed (% -> %). Aborting.',
      v_before_policies, v_after;
  END IF;

  -- A function-only migration must not move a row.
  SELECT count(*) INTO v_after FROM public.marketing_channels;
  IF v_after IS DISTINCT FROM v_before_channels THEN
    RAISE EXCEPTION 'marketing_channels row count changed (% -> %). Aborting.',
      v_before_channels, v_after;
  END IF;

  SELECT count(*) INTO v_after FROM public.marketing_calendar_items;
  IF v_after IS DISTINCT FROM v_before_items THEN
    RAISE EXCEPTION 'marketing_calendar_items row count changed (% -> %). Aborting.',
      v_before_items, v_after;
  END IF;

  RAISE NOTICE '105 verified: rename/archive RPCs in place, % channels and % events untouched.',
    v_before_channels, v_before_items;
END $$;

COMMIT;
