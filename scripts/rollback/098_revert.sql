-- Rollback for 098_audit_events.sql.
--
-- ⚠️ THIS DESTROYS THE AUDIT HISTORY. Every recorded membership, role and module change is
-- in `audit_events` and nowhere else; the triggers do not write a second copy anywhere.
-- If the intent is "roll back the code, keep the history", dump the table first:
--
--   \copy (SELECT * FROM public.audit_events ORDER BY occurred_at) TO 'audit_events.csv' CSV HEADER
--
-- Dropping the triggers alone (without the table) is the safer partial rollback: it stops
-- new events being recorded while leaving everything already captured readable.

BEGIN;

DROP TRIGGER IF EXISTS trg_audit_board_members ON public.board_members;
DROP TRIGGER IF EXISTS trg_audit_team_members ON public.team_members;
DROP TRIGGER IF EXISTS trg_audit_calendar_members ON public.marketing_calendar_members;
DROP TRIGGER IF EXISTS trg_audit_profile_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_audit_app_modules ON public.app_modules;

DROP FUNCTION IF EXISTS private.audit_board_members();
DROP FUNCTION IF EXISTS private.audit_team_members();
DROP FUNCTION IF EXISTS private.audit_calendar_members();
DROP FUNCTION IF EXISTS private.audit_profile_role();
DROP FUNCTION IF EXISTS private.audit_app_modules();
DROP FUNCTION IF EXISTS private.record_audit_event(text, text, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS private.audit_person_name(uuid);

DROP TABLE IF EXISTS public.audit_events;

DELETE FROM public.applied_migrations WHERE filename LIKE '098%';

COMMIT;
