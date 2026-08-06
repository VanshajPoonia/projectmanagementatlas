-- 087: make marketing calendar check-offs shared, not per-viewer.
--
-- A marketing calendar is a shared plan. "Was this posted?" is a fact about the
-- item, not an opinion held by whoever is looking at it. But SELECT on
-- marketing_calendar_checks has been `user_id = auth.uid() OR is_admin` since 033,
-- and the client infers "missed" from the *absence* of a row — so a member who
-- never personally ticked an item saw an empty check set and every past item
-- rendered as missed, even when a teammate had marked it posted hours earlier.
-- That is the bug the owner reported: Kayla's work all green, Bobby's all red,
-- same calendar, same items.
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

COMMIT;
