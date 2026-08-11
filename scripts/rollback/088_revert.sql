-- Rollback for 088_marketing_channel_reorder.sql.
--
-- Drops the reorder RPC. Channel positions keep whatever order they were last
-- dragged into — this only removes the ability to change it, it does not restore
-- any previous ordering (nothing records one).
--
-- Only worth running if the matching client change is coming off too: with 088
-- reverted but the new client deployed, dragging a column shows the reorder
-- optimistically and then snaps back with an error toast on every attempt.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it
-- deliberately, then delete 088's row from public.applied_migrations so the ledger
-- matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '088_marketing_channel_reorder.sql';

BEGIN;

DROP FUNCTION IF EXISTS public.reorder_marketing_channels(UUID[]);

COMMIT;
