-- Revert 132 (retrospectives).
--
-- ⚠️ THIS DESTROYS DATA - every retrospective, note, vote and follow-up action, including
-- anonymous notes that exist nowhere else. Dump first if the record matters:
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only \
--     -t public.retrospectives -t public.retro_note_groups -t public.retro_notes \
--     -t public.retro_votes -t public.retro_actions -Fc -f retros.dump
--
-- ⚠️ Deliberately NOT in that list: public.retro_note_authors. Dumping it would create an
-- un-policed file mapping every anonymous note to the person who wrote it, which is the one
-- thing this feature promised would not exist. If a restore is ever needed, anonymous notes
-- come back unowned - which is what anonymous already looks like.

BEGIN;

DROP TRIGGER IF EXISTS enforce_retro_action       ON public.retro_actions;
DROP TRIGGER IF EXISTS enforce_retro_vote         ON public.retro_votes;
DROP TRIGGER IF EXISTS recount_retro_votes        ON public.retro_votes;
DROP TRIGGER IF EXISTS record_retro_note_author   ON public.retro_notes;
DROP TRIGGER IF EXISTS enforce_retro_note         ON public.retro_notes;
DROP TRIGGER IF EXISTS enforce_retrospective      ON public.retrospectives;
DROP TRIGGER IF EXISTS touch_retro_actions        ON public.retro_actions;
DROP TRIGGER IF EXISTS touch_retro_notes          ON public.retro_notes;
DROP TRIGGER IF EXISTS touch_retrospectives       ON public.retrospectives;

DROP TABLE IF EXISTS public.retro_actions;
DROP TABLE IF EXISTS public.retro_votes;
DROP TABLE IF EXISTS public.retro_note_authors;
DROP TABLE IF EXISTS public.retro_notes;
DROP TABLE IF EXISTS public.retro_note_groups;
DROP TABLE IF EXISTS public.retrospectives;

-- ⚠️ Functions AFTER the tables, and the order is load-bearing: a POLICY depends on the
-- function it calls, so dropping private.is_retro_note_author() while retro_notes still exists
-- fails with "cannot drop function ... because other objects depend on it" and aborts the whole
-- transaction. Found by running this file rather than by reading it - which is the only way a
-- rollback script is ever verified.
DROP FUNCTION IF EXISTS public.my_retro_note_ids(UUID);
DROP FUNCTION IF EXISTS private.is_retro_note_author(UUID);
DROP FUNCTION IF EXISTS private.enforce_retro_action();
DROP FUNCTION IF EXISTS private.enforce_retro_vote();
DROP FUNCTION IF EXISTS private.recount_retro_votes();
DROP FUNCTION IF EXISTS private.record_retro_note_author();
DROP FUNCTION IF EXISTS private.enforce_retro_note();
DROP FUNCTION IF EXISTS private.enforce_retrospective();
DROP FUNCTION IF EXISTS private.retro_template_columns(TEXT);

DELETE FROM public.applied_migrations WHERE filename = '132_retrospectives.sql';

COMMIT;
