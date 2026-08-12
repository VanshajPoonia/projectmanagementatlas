-- 091: an admin-only large-file path for task attachments.
--
-- THE PROBLEM
-- Task attachments are base64 data URIs stored in task_attachments.file_data, a
-- Postgres TEXT column. Two ceilings sit on top of that: a 10 MB check in the
-- client (components/board/task-detail-modal.tsx) and the 14,000,000-byte CHECK
-- on octet_length(file_data) added by 043 — 14 MB of base64 is ~10.5 MB raw, so
-- the two are effectively the same limit and raising only the client constant
-- would trade a friendly message for a constraint violation.
--
-- Raising the base64 ceiling is the wrong lever regardless. Base64 inflates every
-- file by 33%, the whole payload crosses PostgREST as JSON on download, and every
-- byte lands inside the database — which on the current Supabase Free plan shares
-- a 500 MB budget with all the actual data. Three 100 MB uploads would end the app.
--
-- THE FIX
-- A second, parallel path that puts the bytes in Supabase Storage instead, exactly
-- as marketing event assets already do (076 + 079): a private bucket, a MIME
-- allowlist, object policies keyed off the owning row's UUID folder prefix. The
-- inline base64 path is left completely untouched — same 10 MB limit, same
-- behaviour, same rows — so nothing anyone does today changes.
--
-- WHO CAN USE IT
-- Uploading a large file is admin-only, and the admin must opt in per upload (the
-- client renders a "Large file" toggle). That gate is enforced here, in RLS, not
-- just in the client: the INSERT policy on task_attachments rejects any row
-- carrying a storage_path unless private.is_admin_user() (true for BOTH 'admin'
-- and 'super_admin' — see 047; do NOT write role = 'admin' here, that silently
-- excludes Bobby and Kayla). The storage.objects INSERT policy carries the same
-- gate, so a non-admin cannot upload an orphan object either.
--
-- READING is deliberately NOT admin-gated: anyone who can already see the task can
-- download its large attachments, otherwise an admin could only attach files that
-- nobody on the task could open.
--
-- 50 MB is the per-file cap because that is the Supabase Free plan's hard ceiling
-- — it cannot be raised by configuration, only by changing plan. Storage on Free
-- is also capped at 1 GB in total, which is ~20 files at full size; that budget is
-- the reason this stays an admin-only, opt-in path rather than the default.
--
-- No REVOKE block is needed: task_attachments is an existing table whose grants
-- were set by 035, and this migration creates no new table in public. (The trap
-- from 090 — Supabase default-granting ALL on new public tables to anon and
-- authenticated — does not apply to a plain ADD COLUMN.)
--
-- Post-conditions run inside the transaction: the whole thing rolls back rather
-- than half-applying. Paired rollback: scripts/rollback/091_revert.sql

BEGIN;

-- Row count before, so the assertions can prove no existing attachment moved.
CREATE TEMP TABLE _091_precheck ON COMMIT DROP AS
SELECT
  count(*)                                    AS attachment_rows,
  count(*) FILTER (WHERE file_data IS NOT NULL) AS inline_rows
FROM public.task_attachments;

-- ---------------------------------------------------------------------------
-- 1. The bucket. Private; the client reads through short-lived signed URLs.
--    The MIME allowlist matches marketing-assets (079) — the same office/design
--    /video/archive set a PM tool actually receives.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-assets',
  'task-assets',
  FALSE,
  52428800, -- 50 MB — the Supabase Free plan's hard per-file ceiling.
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'image/vnd.adobe.photoshop',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/postscript',
    'text/plain',
    'text/csv',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'application/zip'
  ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- 2. The column. Nullable: an attachment is EITHER inline base64 OR a storage
--    object, never both and never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_attachments'::regclass
      AND conname = 'task_attachments_storage_path_key'
  ) THEN
    ALTER TABLE public.task_attachments
      ADD CONSTRAINT task_attachments_storage_path_key UNIQUE (storage_path);
  END IF;
END $$;

ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_storage_xor_inline_check;
ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_storage_xor_inline_check
  CHECK (
    (file_data IS NOT NULL AND storage_path IS NULL)
    OR
    (file_data IS NULL AND storage_path IS NOT NULL)
  );

-- A storage-backed row must carry a truthful, in-range size: the UI shows it and
-- the harness asserts on it. 043's octet_length CHECK still guards the inline
-- path and is unaffected here (octet_length(NULL) yields NULL, which a CHECK
-- treats as satisfied, so storage-backed rows pass it without weakening it).
ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_storage_size_check;
ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_storage_size_check
  CHECK (
    storage_path IS NULL
    OR (file_size IS NOT NULL AND file_size > 0 AND file_size <= 52428800)
  );

CREATE INDEX IF NOT EXISTS idx_task_attachments_storage_path
  ON public.task_attachments(storage_path)
  WHERE storage_path IS NOT NULL;

COMMENT ON COLUMN public.task_attachments.storage_path IS
  'Set only for admin-uploaded large files living in the task-assets bucket; '
  'mutually exclusive with file_data (the inline base64 path). Format: <task_id>/<uuid>.<ext>';

-- ---------------------------------------------------------------------------
-- 3. RLS on the metadata row.
--    SELECT and DELETE are recreated verbatim from 035 (no behaviour change) so
--    the post-condition can assert the exact policy set. INSERT gains the admin
--    gate on storage-backed rows and is otherwise identical.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Collaborators can view task attachments" ON public.task_attachments;
CREATE POLICY "Collaborators can view task attachments"
  ON public.task_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can upload task attachments" ON public.task_attachments;
CREATE POLICY "Collaborators can upload task attachments"
  ON public.task_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    -- The large-file path is admin-only. A non-admin inserting storage_path is
    -- rejected here even if they somehow got an object uploaded.
    AND (storage_path IS NULL OR private.is_admin_user())
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can delete task attachments" ON public.task_attachments;
CREATE POLICY "Collaborators can delete task attachments"
  ON public.task_attachments FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_delete_task(t.created_by)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. RLS on the objects themselves. Paths are '<task_id>/<uuid>.<ext>', so the
--    first path segment identifies the owning task — same trick as 076.
--    No UPDATE policy is created: objects are immutable, uploads use upsert:false.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "View task attachment objects" ON storage.objects;
CREATE POLICY "View task attachment objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'task-assets'
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id::TEXT = (storage.foldername(name))[1]
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Upload task attachment objects" ON storage.objects;
CREATE POLICY "Upload task attachment objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'task-assets'
    AND private.is_admin_user()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id::TEXT = (storage.foldername(name))[1]
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Delete task attachment objects" ON storage.objects;
CREATE POLICY "Delete task attachment objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'task-assets'
    AND private.is_admin_user()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id::TEXT = (storage.foldername(name))[1]
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before        BIGINT;
  v_after         BIGINT;
  v_inline_before BIGINT;
  v_inline_after  BIGINT;
  v_policies      TEXT[];
  v_expected      TEXT[] := ARRAY[
    'Collaborators can delete task attachments',
    'Collaborators can upload task attachments',
    'Collaborators can view task attachments'
  ];
  v_limit         BIGINT;
  v_public        BOOLEAN;
  v_obj_policies  INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.task_attachments'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on task_attachments. Aborting.';
  END IF;

  -- The admin gate depends on this function existing and covering super_admin.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'is_admin_user'
  ) THEN
    RAISE EXCEPTION 'private.is_admin_user() is missing — the admin gate would be unenforceable. Aborting.';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'task_attachments';

  IF v_policies IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'Unexpected policy set on task_attachments. Expected %, found %. Aborting.',
      v_expected, v_policies;
  END IF;

  SELECT count(*) INTO v_obj_policies
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN (
      'View task attachment objects',
      'Upload task attachment objects',
      'Delete task attachment objects'
    );
  IF v_obj_policies <> 3 THEN
    RAISE EXCEPTION
      'Expected 3 task-assets object policies, found %. Aborting.', v_obj_policies;
  END IF;

  SELECT file_size_limit, public INTO v_limit, v_public
  FROM storage.buckets WHERE id = 'task-assets';
  IF v_limit IS DISTINCT FROM 52428800 THEN
    RAISE EXCEPTION 'task-assets file_size_limit is %, expected 52428800. Aborting.', v_limit;
  END IF;
  IF v_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'task-assets bucket must be private. Aborting.';
  END IF;

  -- The inline path must be untouched: same rows, same count still carrying base64.
  SELECT attachment_rows, inline_rows INTO v_before, v_inline_before FROM _091_precheck;
  SELECT count(*), count(*) FILTER (WHERE file_data IS NOT NULL)
    INTO v_after, v_inline_after
  FROM public.task_attachments;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION
      'task_attachments row count changed during an additive migration (% -> %). Aborting.',
      v_before, v_after;
  END IF;
  IF v_inline_before IS DISTINCT FROM v_inline_after THEN
    RAISE EXCEPTION
      'Inline (base64) attachment count changed (% -> %). Aborting.',
      v_inline_before, v_inline_after;
  END IF;

  RAISE NOTICE '091 verified: % attachments intact (% inline), 3 table policies, 3 object policies, 50 MB private bucket.',
    v_after, v_inline_after;
END $$;

COMMIT;
