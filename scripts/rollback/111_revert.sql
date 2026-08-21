-- Revert 111: remove board-level attachments.
--
-- ⚠️ DESTRUCTIVE. Dropping board_attachments destroys every row. If the intent is "roll back the
-- code, keep the files", dump the table AND download the bucket's objects before running this.
--
-- ⚠️ THE BUCKET AND ITS OBJECTS ARE NOT REMOVED HERE, ON PURPOSE. Supabase installs a
-- storage.protect_delete() trigger that refuses any direct DELETE on storage.objects or
-- storage.buckets:
--
--     ERROR: Direct deletion from storage tables is not allowed. Use the Storage API instead.
--     HINT:  This prevents accidental data loss from orphaned objects.
--
-- An earlier version of this file did try, and the whole revert aborted at that line - which is
-- worse than not attempting it, because the operator is left believing the rollback ran. The
-- objects have to go through the Storage API instead, after this script:
--
--     node --env-file=.env.local -e '
--     import("@supabase/supabase-js").then(async ({createClient}) => {
--       const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
--       const { data: folders } = await c.storage.from("board-assets").list()
--       for (const f of folders ?? []) {
--         const { data: objs } = await c.storage.from("board-assets").list(f.name)
--         if (objs?.length) await c.storage.from("board-assets").remove(objs.map(o => `${f.name}/${o.name}`))
--       }
--       console.log(await c.storage.deleteBucket("board-assets"))
--     })'
--
-- Leaving the bucket in place is harmless on its own: with the policies below dropped, nothing
-- but the service role can read it.

BEGIN;

DROP POLICY IF EXISTS "View board attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "Upload board attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "Delete board attachment objects" ON storage.objects;

DROP POLICY IF EXISTS "View board attachments" ON public.board_attachments;
DROP POLICY IF EXISTS "Upload board attachments" ON public.board_attachments;
DROP POLICY IF EXISTS "Delete board attachments" ON public.board_attachments;

DROP TABLE IF EXISTS public.board_attachments;
DROP FUNCTION IF EXISTS private.can_view_board(UUID);

DO $$
BEGIN
  IF to_regclass('public.board_attachments') IS NOT NULL THEN
    RAISE EXCEPTION '111 revert post-condition: board_attachments still exists';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE '%board attachment objects%') <> 0 THEN
    RAISE EXCEPTION '111 revert post-condition: storage policies survived';
  END IF;
END $$;

COMMIT;
