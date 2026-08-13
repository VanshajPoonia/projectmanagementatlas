-- Rollback for 100_deprovision_keeps_work.sql.
--
-- ⚠️ THIS ONLY WORKS IF NOBODY HAS BEEN DELETED YET.
--
-- 100 relaxed four columns to nullable so that deleting an account keeps the work. If any
-- account HAS since been deleted, those columns now hold NULLs, and restoring NOT NULL would
-- fail — correctly, because there is no honest value to put back. The original author is
-- gone; inventing one would be a lie, and deleting the rows would destroy exactly the work
-- 100 exists to protect. The pre-check below refuses rather than doing either.
--
-- If it refuses and you still need the old behaviour, the recoverable path is to leave the
-- columns nullable (they are harmless) and drop only the audit trigger at the bottom.
--
-- ⚠️ Reverting also RESTORES the original bug: no account that has ever created a board can
-- be deleted, and deleting anyone else destroys their comments and any company-wide
-- bookmarks they created.

BEGIN;

DO $$
DECLARE
  v_boards    int;
  v_tasks     int;
  v_comments  int;
  v_bookmarks int;
BEGIN
  SELECT count(*) INTO v_boards    FROM public.boards        WHERE created_by IS NULL;
  SELECT count(*) INTO v_tasks     FROM public.tasks         WHERE created_by IS NULL;
  SELECT count(*) INTO v_comments  FROM public.task_comments WHERE user_id IS NULL;
  SELECT count(*) INTO v_bookmarks FROM public.bookmarks     WHERE created_by IS NULL;

  IF v_boards + v_tasks + v_comments + v_bookmarks > 0 THEN
    RAISE EXCEPTION
      'Cannot revert: % board(s), % task(s), % comment(s) and % bookmark(s) already have no author, so NOT NULL cannot be restored without destroying or falsifying them. See this file''s header.',
      v_boards, v_tasks, v_comments, v_bookmarks;
  END IF;
END $$;

ALTER TABLE public.boards        ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE public.tasks         ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE public.task_comments ALTER COLUMN user_id    SET NOT NULL;
ALTER TABLE public.bookmarks     ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_user_id_fkey;
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_author_id_fkey;
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.bookmarks DROP CONSTRAINT IF EXISTS bookmarks_created_by_fkey;
ALTER TABLE public.bookmarks
  ADD CONSTRAINT bookmarks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

DROP TRIGGER IF EXISTS trg_audit_profile_deleted ON public.profiles;
DROP FUNCTION IF EXISTS private.audit_profile_deleted();

DELETE FROM public.applied_migrations WHERE filename LIKE '100%';

COMMIT;
