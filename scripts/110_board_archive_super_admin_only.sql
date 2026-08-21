-- 110: only a super admin may archive a board, not just restore one.
--
-- WHAT IS WRONG
-- 069 Part B made the RESTORE transition (archived_at NOT NULL -> NULL) super-admin-only and
-- deliberately left ARCHIVING (NULL -> NOT NULL) open to any admin, saying so in its own header:
--
--     "restore ... requires super_admin. Archiving itself (NULL -> NOT NULL) is unchanged,
--      still open to any admin via the existing UPDATE policy."
--
-- That is half of what was asked for. Bobby's request (task ab5cd104, "How archived boards
-- behave after archived") reads:
--
--     "maybe we would only allow a super admin to archive and also to un-archive"
--
-- and item (5) of his Super Admin list repeats it: "the super admin should be the only one that
-- can undo a archived anything no matter what it is. This is as much a security measure as it is
-- QC item."
--
-- The asymmetry is the real problem, not the permission itself. A plain admin (Tim, Kogan,
-- Mendy) can archive a board and then cannot bring it back, because 069 already blocks their
-- restore. Archiving is this app's ONLY way to remove a board - there is no delete path anywhere
-- in the codebase, by design - so a plain admin holds a one-way door on other people's work.
-- Confirmed on production: five archived boards, every one of them titled some variant of
-- "delete", so the door is being used exactly as intended and exactly as often as feared.
--
-- THE FIX
-- Extend the same trigger 069 created, rather than adding a second one. It is the natural home:
-- it already runs BEFORE UPDATE on boards and already owns the restore half of this rule, and
-- keeping both transitions in one function means they cannot drift apart the way the UI and the
-- database did.
--
-- WHY THE TRIGGER AND NOT THE UPDATE POLICY
-- The boards UPDATE policy governs the whole row, so narrowing it to super_admin would also stop
-- a plain admin renaming a board or editing its members - a much wider change than was asked
-- for, and one that would break board-management.tsx for three of the five real users. A trigger
-- can judge the specific column transition, which is what the rule is actually about.
--
-- ⚠️ NOT --allow-prod ELIGIBLE. This replaces a function that governs writes on an existing
-- table, so it changes the behaviour of updates that already happen. It is not additive in the
-- sense this repo's rule means. Apply to dev, verify, then decide prod deliberately.
-- Rollback: scripts/rollback/110_revert.sql, which restores 069's function verbatim and destroys
-- no data (both this migration and its revert govern a transition, never a row).
--
-- Gate: pnpm check:board-archive, whose plain-admin case is the control proving the gate is
-- role-specific and not a blanket break - a plain admin must still be able to RENAME a board.

BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_board_restore_super_admin()
 RETURNS TRIGGER
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Restore: archived -> live. Unchanged from 069.
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NOT private.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only a super admin can restore an archived board'
      USING ERRCODE = '42501';
  END IF;

  -- Archive: live -> archived. New in 110. Archiving is the only way a board leaves the
  -- workspace, and only a super admin can undo it, so only a super admin may start it.
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL AND NOT private.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only a super admin can archive a board'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.enforce_board_restore_super_admin() TO authenticated;

-- 069 already created the trigger; re-assert it so this migration is self-contained on a
-- database where it was dropped by hand.
DROP TRIGGER IF EXISTS enforce_board_restore_super_admin ON public.boards;
CREATE TRIGGER enforce_board_restore_super_admin
  BEFORE UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_board_restore_super_admin();

-- Post-conditions, inside the transaction, per this repo's convention for anything that
-- changes write behaviour on an existing table.
DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'enforce_board_restore_super_admin';

  IF v_src IS NULL THEN
    RAISE EXCEPTION '110 post-condition: the trigger function is missing';
  END IF;
  IF v_src NOT LIKE '%Only a super admin can archive a board%' THEN
    RAISE EXCEPTION '110 post-condition: the archive branch was not installed';
  END IF;
  IF v_src NOT LIKE '%Only a super admin can restore an archived board%' THEN
    RAISE EXCEPTION '110 post-condition: 069 restore branch was lost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_board_restore_super_admin'
      AND tgrelid = 'public.boards'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '110 post-condition: the trigger is not attached to public.boards';
  END IF;

  -- RLS must still be on, and no row may have been touched by this migration.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.boards'::regclass) THEN
    RAISE EXCEPTION '110 post-condition: RLS is no longer enabled on boards';
  END IF;
END $$;

COMMIT;
