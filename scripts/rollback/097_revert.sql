-- Reverts scripts/097_user_favorites.sql.
--
-- 097 only ever created a new table, so undoing it is a drop. Nothing else in the schema
-- references user_favorites (entity_id is polymorphic and deliberately carries no foreign
-- key), so there is no dependency to unwind and no other object to restore.
--
-- ⚠️ This destroys every favourite anyone has starred. That is the intended meaning of
-- reverting this migration, but it is real user data rather than derived state, so snapshot
-- it first if the intent is "roll back the code, keep the stars":
--
--     \copy (SELECT * FROM public.user_favorites) TO 'user_favorites_backup.csv' CSV HEADER
--
-- Run:
--   psql "$POSTGRES_URL_NON_POOLING" -f scripts/rollback/097_revert.sql
--   DELETE FROM public.applied_migrations WHERE filename = '097_user_favorites.sql';

BEGIN;

DROP TABLE IF EXISTS public.user_favorites;

DO $post$
BEGIN
  IF to_regclass('public.user_favorites') IS NOT NULL THEN
    RAISE EXCEPTION '097 rollback: user_favorites still exists';
  END IF;
  RAISE NOTICE '097 rollback OK - user_favorites dropped';
END
$post$;

COMMIT;
