-- Rollback for 091_task_large_attachments.sql.
--
-- Removes the admin-only large-file path entirely and restores the pre-091 state:
-- the INSERT policy on task_attachments goes back to 035's definition (no admin
-- gate, because there is no storage_path left to gate), the three task-assets
-- object policies are dropped, the column and its constraints are dropped, and
-- the bucket is removed.
--
-- ⚠️ DESTRUCTIVE IF LARGE FILES EXIST. Dropping storage_path orphans every object
-- in the task-assets bucket — the bytes stay in Storage, still billed against the
-- 1 GB Free-plan budget, but nothing in the database points at them any more and
-- the UI can no longer offer them for download. The guard below refuses to run
-- while any storage-backed attachment exists, so this is safe to attempt blind:
-- it aborts rather than silently losing the link. To roll back anyway, delete
-- those attachments through the app first (which removes the objects too), or
-- read the paths out of the table and clear the bucket by hand:
--     SELECT id, task_id, file_name, storage_path
--     FROM public.task_attachments WHERE storage_path IS NOT NULL;
--
-- The inline base64 path is not touched by 091 or by this file — those rows and
-- 043's octet_length constraint are unaffected either way.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it
-- deliberately, the same way 091 was applied, and then delete 091's row from
-- public.applied_migrations so the ledger matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '091_task_large_attachments.sql';

BEGIN;

DO $$
DECLARE
  v_large BIGINT;
BEGIN
  SELECT count(*) INTO v_large
  FROM public.task_attachments
  WHERE storage_path IS NOT NULL;

  IF v_large > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 091: % storage-backed attachment(s) exist and would be orphaned. Delete them through the app first (see the header of this file). Aborting.',
      v_large;
  END IF;
END $$;

-- Object policies first — they reference the bucket.
DROP POLICY IF EXISTS "View task attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "Upload task attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "Delete task attachment objects" ON storage.objects;

-- The INSERT policy, restored to 035's definition verbatim (admin gate removed).
DROP POLICY IF EXISTS "Collaborators can upload task attachments" ON public.task_attachments;
CREATE POLICY "Collaborators can upload task attachments"
  ON public.task_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- SELECT and DELETE were recreated verbatim by 091 and need no change.

ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_storage_xor_inline_check,
  DROP CONSTRAINT IF EXISTS task_attachments_storage_size_check,
  DROP CONSTRAINT IF EXISTS task_attachments_storage_path_key;

DROP INDEX IF EXISTS public.idx_task_attachments_storage_path;

ALTER TABLE public.task_attachments
  DROP COLUMN IF EXISTS storage_path;

-- Only removable once empty; the guard above already proved no rows reference it,
-- but an object with no metadata row would still block this.
DELETE FROM storage.buckets WHERE id = 'task-assets';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_attachments'
      AND column_name = 'storage_path'
  ) THEN
    RAISE EXCEPTION 'storage_path still present after rollback. Aborting.';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'task-assets') THEN
    RAISE EXCEPTION 'task-assets bucket still present after rollback. Aborting.';
  END IF;

  RAISE NOTICE '091 rolled back: column, constraints, object policies and bucket removed.';
END $$;

COMMIT;
