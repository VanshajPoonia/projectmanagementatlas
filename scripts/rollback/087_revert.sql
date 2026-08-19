-- Rollback for 087_marketing_checks_shared.sql.
--
-- Restores the pre-087 policies verbatim: SELECT and DELETE on
-- marketing_calendar_checks go back to being scoped to the row's own author
-- (plus the blanket admin policy, which 087 never touched).
--
-- Running this re-opens the bug 087 fixed - a calendar member sees only their own
-- check-offs and every past item a teammate completed renders as "missed" - so it
-- is only worth running if 087 has to come off before the matching client change
-- is reverted too. Applying it while the new client is deployed is the bad
-- combination: the client stops filtering by user_id, the policy starts filtering
-- for it, and un-ticking silently deletes nothing.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it
-- deliberately, the same way 087 was applied, and then delete 087's row from
-- public.applied_migrations so the ledger matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '087_marketing_checks_shared.sql';

BEGIN;

DROP POLICY IF EXISTS "Members view calendar item checks" ON public.marketing_calendar_checks;
DROP POLICY IF EXISTS "Users view own marketing calendar checks" ON public.marketing_calendar_checks;
CREATE POLICY "Users view own marketing calendar checks"
  ON public.marketing_calendar_checks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR private.is_admin_user());

DROP POLICY IF EXISTS "Members delete calendar item checks" ON public.marketing_calendar_checks;
DROP POLICY IF EXISTS "Users delete own marketing calendar checks" ON public.marketing_calendar_checks;
CREATE POLICY "Users delete own marketing calendar checks"
  ON public.marketing_calendar_checks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON COLUMN public.marketing_calendar_checks.user_id IS
  'The user who marked this item posted/missed. No longer implies calendar ownership as of '
  'migration 085 - access is governed by calendar_id on the parent item plus '
  'marketing_calendar_members, not by this column.';

COMMIT;
