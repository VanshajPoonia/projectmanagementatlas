-- Rollback for 118_board_hierarchy.sql.
--
-- ⚠️ THIS DESTROYS THE HIERARCHY. Dropping `boards.parent_board_id` drops every parent/child
-- relationship anyone has set, and nothing else records them - the whole design of 118 is that
-- descendant membership is COMPUTED from this column rather than stored anywhere. Re-applying
-- 118 gives you the column back with every board a root again. If the intent is "roll back the
-- code, keep the hierarchy", dump the pairs first:
--
--   SELECT id, parent_board_id FROM public.boards WHERE parent_board_id IS NOT NULL;
--
-- No task, comment, column or membership row is touched. Only the structural pointer goes.
--
-- ── Sequence this with a client change ──────────────────────────────────────────────
-- `app/views/page.tsx` SELECTS `parent_board_id`, and `board-management.tsx` writes it on
-- create and edit. Reverting under the current code makes every /views load and every board
-- save fail with an unknown-column error. Revert the CODE first (git revert, push - `main`
-- auto-deploys), confirm the deploy, then run this.
--
-- 119 does NOT depend on 118: `saved_views` has no reference to the column. They can be
-- reverted independently, in either order.

BEGIN;

DROP TRIGGER IF EXISTS enforce_board_hierarchy_acyclic ON public.boards;
DROP FUNCTION IF EXISTS private.enforce_board_hierarchy_acyclic();
DROP FUNCTION IF EXISTS public.board_descendants(UUID, INT);

DROP INDEX IF EXISTS public.idx_boards_parent_board_id;

ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_parent_not_self_check;
ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_parent_board_id_fkey;
ALTER TABLE public.boards DROP COLUMN IF EXISTS parent_board_id;

DELETE FROM public.applied_migrations WHERE filename = '118_board_hierarchy.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'boards' AND column_name = 'parent_board_id'
  ) THEN
    RAISE EXCEPTION 'parent_board_id survived the revert. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_board_hierarchy_acyclic'
      AND tgrelid = 'public.boards'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The cycle trigger survived the revert. Aborting.';
  END IF;

  RAISE NOTICE '118 reverted: boards is flat again.';
END $$;

COMMIT;
