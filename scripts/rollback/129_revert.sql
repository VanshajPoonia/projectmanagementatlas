-- Revert 129 (project purpose + goals).
--
-- ⚠️ THIS DESTROYS DATA. Every goal, every board purpose statement and the ENTIRE measurement
-- history goes with it, and the history is the one part that cannot be reconstructed from
-- anywhere else - `goals.current_value` only ever holds the latest number. If the intent is
-- "roll the code back, keep the record", dump these four tables first:
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only \
--     -t public.board_purpose -t public.goals -t public.goal_links -t public.goal_checkins \
--     -Fc -f goals-backup.dump
--
-- The app_modules row is removed too, so the module disappears rather than staying switched
-- on and pointing at tables that no longer exist.

BEGIN;

DROP TRIGGER IF EXISTS record_goal_checkin          ON public.goals;
DROP TRIGGER IF EXISTS open_goal_checkin            ON public.goals;
DROP TRIGGER IF EXISTS enforce_goal_checkin_carrier ON public.goals;
DROP TRIGGER IF EXISTS touch_goals                  ON public.goals;
DROP TRIGGER IF EXISTS touch_board_purpose          ON public.board_purpose;

DROP FUNCTION IF EXISTS private.record_goal_checkin();
DROP FUNCTION IF EXISTS private.open_goal_checkin();
DROP FUNCTION IF EXISTS private.enforce_goal_checkin_carrier();

DROP TABLE IF EXISTS public.goal_checkins;
DROP TABLE IF EXISTS public.goal_links;
DROP TABLE IF EXISTS public.goals;
DROP TABLE IF EXISTS public.board_purpose;

DELETE FROM public.app_modules WHERE module_key = 'strategy';

DELETE FROM public.applied_migrations WHERE filename = '129_purpose_and_goals.sql';

COMMIT;
