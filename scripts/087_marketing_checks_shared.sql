-- 087: make marketing calendar check-offs shared, not per-viewer.
--
-- A marketing calendar is a shared plan. "Was this posted?" is a fact about the
-- item, not an opinion held by whoever is looking at it. But SELECT on
-- marketing_calendar_checks has been `user_id = auth.uid() OR is_admin` since 033,
-- and the client infers "missed" from the *absence* of a row — so a member who
-- never personally ticked an item saw an empty check set and every past item
-- rendered as missed, even when a teammate had marked it posted hours earlier.
-- That is the bug the owner reported: one person's calendar all green, another's
-- all red, same calendar, same items.
--
-- 085 deliberately left this narrow. Its stated reason was real: statusByItem in
-- marketing-calendar.tsx is a Map<item_id, Check>, and since the unique index is
-- (item_id, user_id) a calendar-wide SELECT can return two rows for one item,
-- which `new Map(...)` would silently collapse — dropping one member's mark with
-- no error. That client-side hazard is now closed: marketing-calendar.tsx merges
-- rows through resolveCheck() (any 'posted' beats a 'missed'; within the same
-- status the newest checked_at wins) instead of last-row-wins. With the collapse
-- handled, the only thing the narrow policy still buys is the bug above.
--
-- WHY THIS IS SAFE TO APPLY BEFORE THE CLIENT SHIPS
-- Both new policies are strict SUPERSETS of the ones they replace:
--     SELECT  old: user_id = auth.uid() OR is_admin
--             new: user_id = auth.uid() OR is_admin OR is_calendar_member(...)
--     DELETE  old: user_id = auth.uid()
--             new: user_id = auth.uid() OR is_calendar_member(...)
-- Every row that was visible stays visible and every delete that was permitted
-- stays permitted, so no existing flow can stop working. The deployed client also
-- still filters `user_id` explicitly on its own queries, which means this file is
-- a no-op for the live app until the matching client change deploys. Applying it
-- first is therefore the safe ordering, not the risky one.
--
-- No table, column, constraint, index or row is touched — this is two policy
-- definitions and a comment. The assertions below make that mechanical rather
-- than a claim: the transaction aborts and rolls back if the dependency function
-- is missing, if RLS gets disabled, if the expected policy set is not exactly
-- what lands, or if a single check row changes. To roll back, run
-- scripts/rollback/087_revert.sql — it restores the previous policies verbatim.
--
-- SELECT and DELETE both widen to calendar membership:
--   * SELECT, so every member sees the same posted/missed state.
--   * DELETE, so un-ticking an item actually clears it. The client deletes every
--     mark on the item (not just the caller's); under the old policy a member
--     un-ticking something a teammate had marked deleted zero rows and the UI
--     snapped straight back to green.
-- INSERT and UPDATE are untouched — they stay `user_id = auth.uid()` plus the
-- membership join from 085, so a mark is still attributable to the person who
-- made it. Members can clear a shared mark; they cannot forge one in someone
-- else's name.
--
-- Requires 033 (the table), 047 (private.is_admin_user), 085
-- (private.is_calendar_member + marketing_calendar_items.calendar_id).

BEGIN;

-- Fail before touching anything if 085 is not actually present on this database.
-- Without this the CREATE POLICY below would be the first thing to notice, and
-- only after the old policies had already been dropped.
DO $$
BEGIN
  IF to_regprocedure('private.is_calendar_member(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'private.is_calendar_member(uuid, uuid) is missing — migration 085 has not been applied to this database. Aborting.';
  END IF;
  IF to_regprocedure('private.is_admin_user()') IS NULL THEN
    RAISE EXCEPTION
      'private.is_admin_user() is missing — migration 047 has not been applied to this database. Aborting.';
  END IF;
END $$;

-- Row count is captured before the policy swap and re-checked at the end. This
-- migration must not alter a single check row; the assertion is what makes that
-- a guarantee instead of an intention.
CREATE TEMP TABLE _087_precheck ON COMMIT DROP AS
SELECT count(*) AS check_rows FROM public.marketing_calendar_checks;

DROP POLICY IF EXISTS "Users view own marketing calendar checks" ON public.marketing_calendar_checks;
DROP POLICY IF EXISTS "Members view calendar item checks" ON public.marketing_calendar_checks;
CREATE POLICY "Members view calendar item checks"
  ON public.marketing_calendar_checks FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR private.is_admin_user()
    OR EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND private.is_calendar_member(item.calendar_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users delete own marketing calendar checks" ON public.marketing_calendar_checks;
DROP POLICY IF EXISTS "Members delete calendar item checks" ON public.marketing_calendar_checks;
CREATE POLICY "Members delete calendar item checks"
  ON public.marketing_calendar_checks FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND private.is_calendar_member(item.calendar_id, auth.uid())
    )
  );

COMMENT ON COLUMN public.marketing_calendar_checks.user_id IS
  'The user who marked this item posted/missed — attribution only. As of migration 087 '
  'the mark itself is shared: every member of the parent item''s calendar can read it and '
  'clear it, and the client merges any duplicate (item_id, user_id) rows through '
  'resolveCheck() into the one state the whole calendar sees. Only the author can '
  'insert or update a row under their own user_id.';

-- Post-conditions. Any failure here rolls the whole transaction back, leaving the
-- database exactly as it was found.
DO $$
DECLARE
  v_before   BIGINT;
  v_after    BIGINT;
  v_policies TEXT[];
  v_expected TEXT[] := ARRAY[
    'Admins manage marketing calendar checks',
    'Members create own calendar item checks',
    'Members delete calendar item checks',
    'Members update own calendar item checks',
    'Members view calendar item checks'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.marketing_calendar_checks'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on marketing_calendar_checks. Aborting.';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'marketing_calendar_checks';

  IF v_policies IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'Unexpected policy set on marketing_calendar_checks. Expected %, found %. Aborting.',
      v_expected, v_policies;
  END IF;

  SELECT check_rows INTO v_before FROM _087_precheck;
  SELECT count(*) INTO v_after FROM public.marketing_calendar_checks;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION
      'marketing_calendar_checks row count changed during a policy-only migration (% -> %). Aborting.',
      v_before, v_after;
  END IF;

  RAISE NOTICE '087 verified: % policies, % check rows untouched.', array_length(v_policies, 1), v_after;
END $$;

COMMIT;
