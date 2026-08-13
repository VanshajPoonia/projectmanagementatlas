-- Rollback for 099_private_board_columns.sql.
--
-- ⚠️ This REOPENS the leak: every signed-in user regains the ability to read the column
-- titles, order and status keys of every private board. Only run it if 099 is actively
-- breaking something, and prefer diagnosing that instead — the fix is one policy and its
-- helper has been in use on tasks since 061.

BEGIN;

DROP POLICY IF EXISTS "Users can view visible columns" ON public.columns;

CREATE POLICY "Users can view all columns" ON public.columns FOR SELECT
  USING (auth.uid() IS NOT NULL);

DELETE FROM public.applied_migrations WHERE filename LIKE '099%';

COMMIT;
