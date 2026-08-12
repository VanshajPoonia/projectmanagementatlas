-- Rollback for 093_raise_upload_limits.sql.
--
-- Restores the pre-093 limits: chat-attachments back to 10 MB with the narrowed MIME
-- list 092 gave it (no video, no Photoshop, no PostScript), and task-assets back to
-- the 50 MB / 23-type set 091 gave it — which is what it already had, since 093 only
-- re-asserted it.
--
-- Neither bucket's `public` flag is touched: they must stay private, and re-opening
-- them is what scripts/rollback/092_revert.sql is for (read its warning first).
--
-- ⚠️ Files already uploaded are NOT removed or shrunk. Any chat attachment larger
-- than 10 MB, or of a type dropped from the list, stays in the bucket and keeps
-- working — only NEW uploads are constrained. Check what would become
-- non-reproducible before running:
--     SELECT m.id, m.attachment_path, (o.metadata->>'size')::bigint AS bytes,
--            o.metadata->>'mimetype' AS mime
--     FROM public.chat_messages m
--     JOIN storage.objects o ON o.name = m.attachment_path AND o.bucket_id = 'chat-attachments'
--     WHERE (o.metadata->>'size')::bigint > 10485760;
--
-- This is not a numbered migration and the runner will not pick it up. Apply it
-- deliberately, then delete 093's row from public.applied_migrations:
--     DELETE FROM public.applied_migrations WHERE filename = '093_raise_upload_limits.sql';

BEGIN;

UPDATE storage.buckets
SET
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip'
  ]::TEXT[]
WHERE id = 'chat-attachments';

-- task-assets returns to exactly what 091 set (unchanged in practice).
UPDATE storage.buckets
SET file_size_limit = 52428800
WHERE id = 'task-assets';

DO $$
DECLARE
  v_chat BIGINT;
BEGIN
  SELECT file_size_limit INTO v_chat FROM storage.buckets WHERE id = 'chat-attachments';
  IF v_chat IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'chat-attachments limit is %, expected 10485760 after rollback. Aborting.', v_chat;
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('chat-attachments', 'task-assets') AND public) THEN
    RAISE EXCEPTION 'A bucket is public after rollback — 093 must never re-open one. Aborting.';
  END IF;

  RAISE NOTICE '093 rolled back: chat-attachments returned to 10 MB / 18 mime types; both buckets still private.';
END $$;

COMMIT;
