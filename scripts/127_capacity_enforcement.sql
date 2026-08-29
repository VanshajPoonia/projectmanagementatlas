-- 127: make the capacity setting real, so "Refuse it" refuses.
--
-- WHY THIS EXISTS
-- 123 gave every board a `capacity_mode` of `warning` or `enforcement`, and Prompt G is explicit
-- that going over capacity should "warn ... do not block by default unless configured". The
-- warning half shipped. The enforcement half was honoured by ONE dialog and by nothing
-- underneath it - an import, psql, the bulk bar or a future automation could all put a sprint
-- over a capacity its own settings said to refuse, and the screen would show the breach with
-- nothing explaining how it got there.
--
-- That is this repository's single most-repeated defect, and the list is long enough to be
-- embarrassing: `profiles.is_active` had a prominent toggle read by nothing (101),
-- `app_modules` had no writer at all, `board_members.role` could not be granted by any screen,
-- `crm_statuses.requires_reason` was honoured by the Status Control screen and by nothing
-- beneath it (104). Every one of them was "present, prominent, believed, and wired to nothing".
-- A capacity mode that only a React component respects is the same defect, and it is being
-- fixed before it ships to anyone rather than after.
--
-- WHY THIS ONE IS PROD-ELIGIBLE AND 125 IS NOT
-- The trigger goes on `public.sprint_items`, a table migration 123 created three files ago. No
-- write path that existed before Prompt G passes through it, so nothing that already happens
-- can start behaving differently - which is exactly the test the `--allow-prod` rule is asking.
-- Contrast 125, whose trigger sits on `tasks` and therefore runs on every task move on every
-- board in the product. Same feature, two very different risks, so two files.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   - It does not police RE-ESTIMATION. Raising a task's estimate can put a sprint over
--     capacity and this trigger will not stop it, because the guard would have to live on
--     `tasks` (not eligible) and because refusing an estimate is the wrong answer: the honest
--     size of the work is not negotiable, the plan is. The screen keeps warning.
--   - It does not police REMOVAL, obviously, and it does not fire when a sprint's capacity is
--     lowered below what is already planned. Both leave an over-capacity sprint, both are
--     deliberate acts by a person looking at the number, and both keep warning.
--   - It counts an UNESTIMATED item as zero, exactly as the UI does. Any other choice would
--     make the database and the screen disagree about the same sprint, and the screen already
--     reports the unestimated count separately so nobody reads the total as complete.
--
-- SAFETY
-- Additive: one function, one trigger on a table introduced by 123, seeded empty. No existing
-- table, row, policy, grant or trigger is touched, and with zero boards opted in and zero
-- sprints in existence it is a no-op on every database it reaches.
-- Rollback: scripts/rollback/127_revert.sql - drops both, touches no row.

BEGIN;

CREATE TEMP TABLE _127_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)                 AS task_rows,
  (SELECT count(*) FROM public.sprints)               AS sprint_rows,
  (SELECT count(*) FROM public.sprint_items)          AS item_rows,
  (SELECT count(*) FROM public.board_agile_settings)  AS settings_rows,
  -- ⚠️ Captured, never hardcoded. The count legitimately differs by database: dev has 125's
  -- `enforce_wip_limit` and production does not, so a literal here fails on one of them for a
  -- reason that has nothing to do with what this migration does. The claim being made is
  -- "unchanged by this file", and that is what gets compared.
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'tasks' AND NOT t.tgisinternal) AS task_triggers;

/**
 * Refuse work that would take a sprint past a capacity its board asked to have enforced.
 *
 * Reads the board's mode through the sprint, so a board left on `warning` - the default, and
 * what Prompt G asks for - never reaches the RAISE.
 */
CREATE OR REPLACE FUNCTION private.enforce_sprint_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board       UUID;
  v_capacity    NUMERIC;
  v_title       TEXT;
  v_mode        TEXT;
  v_unit        TEXT;
  v_planned     NUMERIC;
  v_incoming    NUMERIC;
BEGIN
  -- Only an ARRIVAL can breach a capacity: an insert, or a re-add that clears removed_at.
  -- A removal, and the activation stamp that writes `committed`, must never be refused here.
  IF TG_OP = 'UPDATE' AND NOT (NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT s.board_id, s.capacity, s.title INTO v_board, v_capacity, v_title
    FROM public.sprints s WHERE s.id = NEW.sprint_id;

  -- No capacity declared is not the same as a capacity of zero, and 123's CHECK already
  -- refuses zero. Nothing to enforce.
  IF v_capacity IS NULL THEN RETURN NEW; END IF;

  SELECT bas.capacity_mode, bas.estimate_unit INTO v_mode, v_unit
    FROM public.board_agile_settings bas
   WHERE bas.board_id = v_board AND bas.is_enabled;

  IF v_mode IS DISTINCT FROM 'enforcement' THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(t.estimate_value), 0) INTO v_planned
    FROM public.sprint_items si
    JOIN public.tasks t ON t.id = si.task_id
   WHERE si.sprint_id = NEW.sprint_id
     AND si.removed_at IS NULL
     AND si.id <> NEW.id;

  SELECT COALESCE(t.estimate_value, 0) INTO v_incoming
    FROM public.tasks t WHERE t.id = NEW.task_id;

  IF v_planned + v_incoming > v_capacity THEN
    -- The message carries the three numbers a person needs to decide what to do, because
    -- "why is this blocked" has to be answerable from the toast alone. A refusal that only
    -- says no is a refusal people route around by switching the feature off.
    RAISE EXCEPTION
      '% is at its capacity of % %. Planning this in would take it to %. Remove something, raise the capacity, or set this board back to warning.',
      v_title, v_capacity, COALESCE(v_unit, 'points'), v_planned + v_incoming
      USING ERRCODE = 'check_violation',
            HINT = 'Work with no estimate counts as zero here, exactly as it does on screen.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_sprint_capacity() FROM PUBLIC, anon, authenticated;

-- ⚠️ Fires AFTER 123's own integrity trigger, and the alphabet is what guarantees it:
-- 'enforce_sprint_capacity' < 'enforce_sprint_item_integrity' - so capacity actually runs
-- FIRST. That is fine and is asserted below, because the two are independent: integrity
-- policies which columns may move, capacity policies how much work is in the sprint, and
-- neither reads a value the other writes. The assertion exists so that if a future trigger
-- IS made to depend on ordering, the dependency is discovered rather than assumed.
DROP TRIGGER IF EXISTS enforce_sprint_capacity ON public.sprint_items;
CREATE TRIGGER enforce_sprint_capacity
  BEFORE INSERT OR UPDATE ON public.sprint_items
  FOR EACH ROW EXECUTE FUNCTION private.enforce_sprint_capacity();

-- ---------------------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_tasks BIGINT; v_sprints BIGINT; v_items BIGINT; v_settings BIGINT; v_task_triggers BIGINT;
BEGIN
  SELECT task_rows, sprint_rows, item_rows, settings_rows, task_triggers
    INTO v_tasks, v_sprints, v_items, v_settings, v_task_triggers FROM _127_precheck;

  IF (SELECT count(*) FROM public.tasks)                <> v_tasks    THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprints)              <> v_sprints  THEN RAISE EXCEPTION 'Sprint rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprint_items)         <> v_items    THEN RAISE EXCEPTION 'Sprint item rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.board_agile_settings) <> v_settings THEN RAISE EXCEPTION 'Agile settings rows moved. Aborting.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'sprint_items' AND t.tgname = 'enforce_sprint_capacity' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'The capacity trigger was not created. Aborting.';
  END IF;

  -- It must be on sprint_items and NOWHERE ELSE. A copy of this on `tasks` would be the
  -- not-eligible-for-prod change that 125 is, arriving by the back door.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = 'enforce_sprint_capacity' AND c.relname <> 'sprint_items' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'The capacity trigger is attached to a table other than sprint_items. Aborting.';
  END IF;

  -- Nothing pre-existing gained a trigger.
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = 'tasks' AND NOT t.tgisinternal) <> v_task_triggers THEN
    RAISE EXCEPTION 'The trigger count on tasks changed from % . This migration must not touch it. Aborting.', v_task_triggers;
  END IF;

  IF has_function_privilege('authenticated', 'private.enforce_sprint_capacity()', 'EXECUTE')
     OR has_function_privilege('anon', 'private.enforce_sprint_capacity()', 'EXECUTE') THEN
    RAISE EXCEPTION 'A client role can execute the capacity trigger function directly. Aborting.';
  END IF;

  RAISE NOTICE '127 verified: capacity enforcement armed on sprint_items; % board(s) opted in, % sprint(s), so it is a no-op here.',
    v_settings, v_sprints;
END $$;

COMMIT;
