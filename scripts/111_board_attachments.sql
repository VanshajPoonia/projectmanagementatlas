-- 111: attach files to a BOARD, not only to a task.
--
-- WHY
-- Bobby's task 40e65a88 is titled "Attach Files/Photos To A Board/Tile/Task". The task half
-- shipped in 020/091/093; the board half never existed - there is no board_attachments table
-- and no component references one. A board-level file is the natural home for the things that
-- belong to a project rather than to one card: the signed contract, the site plan, the brief.
--
-- SHAPE
-- Mirrors task_attachments as 091 left it, with one deliberate simplification: **Storage only,
-- no inline base64 path.** 043 gave tasks a base64 column with a 14 MB CHECK, and 091 added the
-- Storage path beside it for large files, so tasks now carry both. Board files have no legacy to
-- preserve, and inline bytes land in the Postgres row inflated ~33% against a 500 MB database
-- budget. Everything here goes to the private board-assets bucket.
--
-- WHO
--   SELECT  - anyone who can see the board. Reuses 070's exact predicate so a private board's
--             files are as private as the board, and an archived board's files are visible to a
--             super admin only, without restating the rule in a second place that can drift.
--   INSERT  - an admin who can see the board. Matches the columns/tasks convention: admins
--             manage board furniture, and members read it.
--   DELETE  - the uploader, or a super admin. Same shape as 091's task attachment delete, which
--             is scoped to uploaded_by rather than to any admin.
--   UPDATE  - no policy. Objects are immutable; replacing a file means delete and re-upload.
--
-- ⚠️ REVOKE ALL FIRST. Supabase's default privileges hand every new table in public a blanket
-- ALL to anon and authenticated, so granting narrowly is not enough - the wide grant is already
-- there. 095 narrowed the defaults for tables created by migrations, but this asserts it rather
-- than trusting it, because that trap has bitten this repo three times.
--
-- --allow-prod ELIGIBLE. One new table, one new bucket, new policies on both. No existing table,
-- row, policy or grant is touched. Rollback: scripts/rollback/111_revert.sql, which DESTROYS
-- every board attachment row and its objects - dump both first if the intent is "roll back the
-- code, keep the files".
--
-- Gate: pnpm check:board-attachments.

BEGIN;

CREATE TABLE IF NOT EXISTS public.board_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id     UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  file_type    TEXT,
  file_size    BIGINT,
  -- '<board_id>/<uuid>-<name>' in the board-assets bucket. The policies below key off the
  -- first folder segment, so the path layout is load-bearing, not cosmetic.
  storage_path TEXT NOT NULL UNIQUE,
  uploaded_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.board_attachments IS
  'Files attached to a board rather than to a task. Storage-backed only; see 111.';

CREATE INDEX IF NOT EXISTS idx_board_attachments_board_id
  ON public.board_attachments(board_id, created_at DESC);

ALTER TABLE public.board_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.board_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.board_attachments TO authenticated;

-- One helper, so the three policies and the three storage policies below cannot drift from
-- 070's board-visibility rule or from each other.
CREATE OR REPLACE FUNCTION private.can_view_board(p_board_id UUID)
 RETURNS BOOLEAN
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.boards b
    WHERE b.id = p_board_id
      AND (NOT b.is_private OR auth.uid() = b.created_by OR public.is_board_member(b.id, auth.uid()))
      AND (b.archived_at IS NULL OR private.is_super_admin_user())
  );
$function$;

REVOKE ALL ON FUNCTION private.can_view_board(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_view_board(UUID) TO authenticated;

DROP POLICY IF EXISTS "View board attachments" ON public.board_attachments;
CREATE POLICY "View board attachments"
  ON public.board_attachments FOR SELECT
  TO authenticated
  USING (private.can_view_board(board_id));

DROP POLICY IF EXISTS "Upload board attachments" ON public.board_attachments;
CREATE POLICY "Upload board attachments"
  ON public.board_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_admin_user()
    AND private.can_view_board(board_id)
    AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS "Delete board attachments" ON public.board_attachments;
CREATE POLICY "Delete board attachments"
  ON public.board_attachments FOR DELETE
  TO authenticated
  USING (
    private.can_view_board(board_id)
    AND (uploaded_by = auth.uid() OR private.is_super_admin_user())
  );

-- Storage. The ceiling and the MIME allowlist are COPIED FROM task-assets rather than restated,
-- so the two can never drift: it would be indefensible for a PSD to be attachable to a task and
-- refused on a board. 50 MB is the Supabase Free plan's hard per-file limit and cannot be raised
-- without changing plan. If task-assets is somehow absent, fall back to the same 50 MB with no
-- MIME restriction rather than inventing a second list.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'board-assets', 'board-assets', FALSE,
  COALESCE((SELECT file_size_limit FROM storage.buckets WHERE id = 'task-assets'), 52428800),
  (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'task-assets')
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "View board attachment objects" ON storage.objects;
CREATE POLICY "View board attachment objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'board-assets'
    AND private.can_view_board(((storage.foldername(name))[1])::UUID)
  );

DROP POLICY IF EXISTS "Upload board attachment objects" ON storage.objects;
CREATE POLICY "Upload board attachment objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'board-assets'
    AND private.is_admin_user()
    AND private.can_view_board(((storage.foldername(name))[1])::UUID)
  );

DROP POLICY IF EXISTS "Delete board attachment objects" ON storage.objects;
CREATE POLICY "Delete board attachment objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'board-assets'
    AND private.can_view_board(((storage.foldername(name))[1])::UUID)
    AND (
      private.is_super_admin_user()
      OR EXISTS (
        SELECT 1 FROM public.board_attachments a
        WHERE a.storage_path = storage.objects.name
          AND a.uploaded_by = auth.uid()
      )
    )
  );

-- Post-conditions, inside the transaction.
DO $$
DECLARE
  v_policies TEXT[];
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.board_attachments'::regclass) THEN
    RAISE EXCEPTION '111 post-condition: RLS is not enabled on board_attachments';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname) INTO v_policies
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'board_attachments';
  IF v_policies IS DISTINCT FROM
     ARRAY['Delete board attachments','Upload board attachments','View board attachments'] THEN
    RAISE EXCEPTION '111 post-condition: unexpected policy set %', v_policies;
  END IF;

  -- The wide default grant must be gone, and anon must hold nothing at all.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'board_attachments' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION '111 post-condition: anon still holds a grant on board_attachments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'board_attachments'
      AND grantee = 'authenticated' AND privilege_type IN ('UPDATE','TRUNCATE','REFERENCES','TRIGGER')
  ) THEN
    RAISE EXCEPTION '111 post-condition: authenticated holds more than SELECT/INSERT/DELETE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'board-assets' AND public = FALSE) THEN
    RAISE EXCEPTION '111 post-condition: the board-assets bucket is missing or public';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'task-assets')
     AND NOT EXISTS (
       SELECT 1 FROM storage.buckets b, storage.buckets t
       WHERE b.id = 'board-assets' AND t.id = 'task-assets'
         AND b.file_size_limit IS NOT DISTINCT FROM t.file_size_limit
         AND b.allowed_mime_types IS NOT DISTINCT FROM t.allowed_mime_types
     ) THEN
    RAISE EXCEPTION '111 post-condition: board-assets limits do not match task-assets';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE '%board attachment objects%') <> 3 THEN
    RAISE EXCEPTION '111 post-condition: expected exactly 3 storage policies for board-assets';
  END IF;
END $$;

COMMIT;
