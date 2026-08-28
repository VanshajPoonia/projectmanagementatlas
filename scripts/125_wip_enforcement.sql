-- 125: make a WIP limit real, when a board asks for it.
--
-- ⚠️⚠️ NOT --allow-prod ELIGIBLE. This puts a TRIGGER ON `tasks`, which changes the behaviour
-- of writes that already happen - the same reasoning that held 098 back and the same class of
-- change as 113 and 118, both of which reached production only as an explicit owner decision
-- after the risk was stated in writing. Applied to the DEV SANDBOX ONLY. Do not add
-- --allow-prod to this file on an agent's own judgement.
--
-- THE RISK, STATED PLAINLY, so the decision can be made rather than assumed
-- Every task move on every board goes through the tasks UPDATE path. This trigger runs on all
-- of them. If it is wrong, the failure is not "the agile module misbehaves" - it is "nobody
-- can drag a card". Three things bound that:
--   1. It returns immediately unless the destination column has a wip_limit set. Every column
--      in this database has NULL there (123's post-conditions assert it), so on the day it is
--      applied it is a no-op on 100% of writes.
--   2. It returns immediately unless that column's board has board_agile_settings.wip_mode =
--      'enforcement'. There are no settings rows at all until somebody opts a board in, and
--      the default is 'warning'.
--   3. It never blocks a task that is ALREADY in the column - only an arrival. Editing the
--      title of a card sitting in a full column must not fail.
-- So reaching the RAISE requires a board opted into agile, switched to enforcement, and a
-- column given an explicit limit. Three deliberate acts, by an admin, on one board.
--
-- WHY A TRIGGER AND NOT THE UI
-- Prompt G asks for two modes, warning and enforcement. This repo's single most-repeated
-- defect is a control that is present, prominent, believed and wired to nothing -
-- profiles.is_active (101), app_modules (2026-08-15), board_members.role (Prompt B),
-- crm_statuses.requires_reason (104). A limit that only a dialog respects is not enforcement;
-- it is a label. An import, psql, the bulk-move bar or a future automation would all walk
-- straight past it, and the board would show a column over its own stated limit with nothing
-- explaining how it got there. Either the database refuses it or the mode should not be
-- offered - and 123 deliberately ships wip_mode with the UI saying so until this lands.
--
-- WHY NOT RLS
-- A WITH CHECK on the tasks UPDATE policy would rewrite an existing policy, which IS
-- destructive by this repo's definition and strictly worse than a trigger. It would also
-- report the refusal as a silent zero-row write (the trap lib/rls-write.ts exists for),
-- instead of a message naming the column and its limit.
--
-- TRIGGER ORDER MATTERS AND IS NOT AN ACCIDENT
-- Postgres fires row triggers in alphabetical order by name. `enforce_task_lifecycle` REWRITES
-- NEW.column_id on INSERT when tasks.status disagrees with the target column's status_key
-- (the fixture trap recorded in CLAUDE.md). This trigger must therefore see the FINAL
-- destination, not the requested one. 'enforce_wip_limit' sorts after 'enforce_task_lifecycle'
-- ('w' > 't' at index 8), so it does. The post-conditions assert that ordering rather than
-- trusting the name, because a later rename would silently invert it.
--
-- Rollback: scripts/rollback/125_revert.sql - drops the trigger and the function, touches no
-- row, and returns every board to warning-only behaviour.

BEGIN;

CREATE TEMP TABLE _125_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)   AS task_rows,
  (SELECT count(*) FROM public.columns) AS column_rows,
  (SELECT count(*) FROM public.columns WHERE wip_limit IS NOT NULL) AS limited_columns;

CREATE OR REPLACE FUNCTION private.enforce_wip_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   INTEGER;
  v_board   UUID;
  v_mode    TEXT;
  v_current INTEGER;
  v_title   TEXT;
BEGIN
  -- Not an arrival: an in-place edit of a card already in the column can never be refused.
  IF TG_OP = 'UPDATE' AND NEW.column_id IS NOT DISTINCT FROM OLD.column_id THEN
    RETURN NEW;
  END IF;
  -- A task on its way out - archived, soft-deleted or cancelled - does not consume capacity.
  IF NEW.deleted_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.wip_limit, c.board_id, c.title INTO v_limit, v_board, v_title
    FROM public.columns c WHERE c.id = NEW.column_id;

  -- The overwhelmingly common path: no limit on this column, nothing to do.
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  SELECT bas.wip_mode INTO v_mode
    FROM public.board_agile_settings bas
   WHERE bas.board_id = v_board AND bas.is_enabled;

  -- Warning mode, agile off, or no settings row at all: the UI warns, the database allows.
  -- Prompt G: "Do not block by default unless configured."
  IF v_mode IS DISTINCT FROM 'enforcement' THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_current
    FROM public.tasks t
   WHERE t.column_id = NEW.column_id
     AND t.id <> NEW.id
     AND t.deleted_at IS NULL
     AND t.archived_at IS NULL;

  IF v_current >= v_limit THEN
    -- The message names the column, the limit and the count, because "why is this blocked"
    -- must be answerable from the toast alone. A refusal that only says "no" gets worked
    -- around by turning the feature off.
    RAISE EXCEPTION 'Column "%" is at its work-in-progress limit of % (currently %). Finish or move something out before adding more.',
      v_title, v_limit, v_current
      USING ERRCODE = 'check_violation',
            HINT = 'An admin can raise or clear this limit in the board''s agile settings, or switch the board back to warning mode.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_wip_limit() FROM PUBLIC, anon, authenticated;

-- ⚠️ No `OF column_id` clause, and that is 104's lesson applied: a trigger with an OF list
-- cannot police the columns it does not fire on. An UPDATE that clears deleted_at (restoring
-- a task into a full column) never names column_id, and would walk straight past an
-- OF column_id trigger.
DROP TRIGGER IF EXISTS enforce_wip_limit ON public.tasks;
CREATE TRIGGER enforce_wip_limit
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.enforce_wip_limit();

-- ---------------------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_tasks BIGINT; v_columns BIGINT; v_limited BIGINT;
  v_lifecycle_name TEXT := 'enforce_task_lifecycle';
BEGIN
  SELECT task_rows, column_rows, limited_columns INTO v_tasks, v_columns, v_limited FROM _125_precheck;

  IF (SELECT count(*) FROM public.tasks)   <> v_tasks   THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.columns) <> v_columns THEN RAISE EXCEPTION 'Column rows moved. Aborting.'; END IF;

  -- On the day this is applied it must be a no-op. If any column already carries a limit, the
  -- migration is changing live behaviour and the person applying it needs to know first.
  IF v_limited <> 0 THEN
    RAISE EXCEPTION 'Applying WIP enforcement while % column(s) already carry a limit would change live behaviour. Review them first. Aborting.', v_limited;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'tasks' AND t.tgname = 'enforce_wip_limit' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'The WIP trigger was not created. Aborting.';
  END IF;

  -- The ordering the whole design depends on: the lifecycle trigger rewrites column_id, so it
  -- must fire FIRST. Asserted, because a rename would silently invert it and the resulting bug
  -- - a limit checked against the column the caller asked for rather than the one the row
  -- landed in - is invisible in code review.
  IF NOT ('enforce_wip_limit' > v_lifecycle_name) THEN
    RAISE EXCEPTION 'Trigger name ordering broken: enforce_wip_limit must sort after %. Aborting.', v_lifecycle_name;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'tasks' AND t.tgname = v_lifecycle_name AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'enforce_task_lifecycle is missing - the ordering assumption no longer holds. Aborting.';
  END IF;

  RAISE NOTICE '125 verified: WIP enforcement armed, no-op on all % columns (0 carry a limit), % tasks untouched.',
    v_columns, v_tasks;
END $$;

COMMIT;
