-- Revert 116: remove recurrence rules and the occurrence ledger.
--
-- DESTROYS: every recurrence rule and the entire record of which occurrences were already
-- generated. It destroys NO task - tasks produced by a rule are ordinary tasks and survive,
-- as do the five recurrence_* columns on `tasks`, which 116 never wrote to.
--
-- ⚠️ Losing the ledger is not recoverable by re-running the migration. If 116 is ever
-- re-applied afterwards, every active rule starts from an empty ledger and will generate
-- occurrences it has already generated once - the duplicates the UNIQUE constraint exists to
-- prevent. Dump both tables first if the intent is "roll back the code, keep the schedules".

BEGIN;

DROP FUNCTION IF EXISTS public.run_recurrence_generation(UUID, DATE);
DROP FUNCTION IF EXISTS public.create_recurrence_occurrence(UUID, DATE);
DROP FUNCTION IF EXISTS public.next_occurrence_date(DATE, TEXT, INTEGER, INTEGER[], INTEGER);

DROP TABLE IF EXISTS public.recurrence_occurrences;
DROP TABLE IF EXISTS public.recurrence_rules;

DO $$
DECLARE
  v_tasks BIGINT;
  v_recur BIGINT;
BEGIN
  SELECT count(*) INTO v_tasks FROM public.tasks;
  SELECT count(*) INTO v_recur FROM public.tasks WHERE is_recurring;

  -- 025's and 086's columns must be exactly as they were; 116 only ever read them.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'recurrence_weekdays'
  ) THEN
    RAISE EXCEPTION 'tasks.recurrence_weekdays was removed - this revert must not touch tasks. Aborting.';
  END IF;

  RAISE NOTICE '116 reverted: rules and ledger dropped, % tasks intact (% still flagged recurring).',
    v_tasks, v_recur;

  DELETE FROM public.applied_migrations WHERE filename = '116_recurrence_rules.sql';
END $$;

COMMIT;
