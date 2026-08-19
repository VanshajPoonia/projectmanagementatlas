-- Rollback for 092_chat_attachments_private.sql.
--
-- ⚠️ THIS RE-OPENS A PRIVACY HOLE. It restores 002's state: the chat-attachments
-- bucket goes back to public = true, which means every object in it is served off
-- the Storage CDN with NO authentication and NO RLS - anyone holding or guessing a
-- URL can read a direct-message attachment. It also restores the blanket
-- "Users can view all chat attachments" policy, letting any authenticated user read
-- and list every chat attachment rather than only their own conversations.
--
-- Run this only to unblock a genuine regression in chat uploads, and treat it as
-- temporary. The much cheaper first step is almost always to revert the CLIENT
-- (components/chat/chat-panel.tsx + chat-message.tsx) instead: 092 is backwards
-- compatible with the old client for reading, because the legacy image_url column
-- and its rows are left untouched.
--
-- Ordering note: revert the client FIRST, then this. With 092 rolled back but the
-- new client deployed, uploads would write attachment_path to a column that no
-- longer exists and every send with a file would fail.
--
-- The guard below refuses to run while any message actually references an
-- attachment by path, since dropping the column would orphan those objects with no
-- way to render them. Clear or migrate those rows first:
--     SELECT id, sender_id, recipient_id, attachment_path
--     FROM public.chat_messages WHERE attachment_path IS NOT NULL;
--
-- This is not a numbered migration and the runner will not pick it up. Apply it
-- deliberately, then delete 092's row from public.applied_migrations:
--     DELETE FROM public.applied_migrations WHERE filename = '092_chat_attachments_private.sql';

BEGIN;

DO $$
DECLARE
  v_referenced BIGINT;
BEGIN
  SELECT count(*) INTO v_referenced
  FROM public.chat_messages
  WHERE attachment_path IS NOT NULL;

  IF v_referenced > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 092: % message(s) reference an attachment by path and would be orphaned. See the header of this file. Aborting.',
      v_referenced;
  END IF;
END $$;

DROP POLICY IF EXISTS "Upload own chat attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "View chat attachment objects in own conversations" ON storage.objects;
DROP POLICY IF EXISTS "Delete own chat attachment objects" ON storage.objects;

-- 002's policies, restored verbatim.
CREATE POLICY "Users can upload chat attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view all chat attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-attachments');

CREATE POLICY "Users can delete their own chat attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

UPDATE storage.buckets
SET public = TRUE, file_size_limit = NULL, allowed_mime_types = NULL
WHERE id = 'chat-attachments';

DROP INDEX IF EXISTS public.idx_chat_messages_attachment_path;

ALTER TABLE public.chat_messages
  DROP COLUMN IF EXISTS attachment_path;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages'
      AND column_name = 'attachment_path'
  ) THEN
    RAISE EXCEPTION 'attachment_path still present after rollback. Aborting.';
  END IF;

  RAISE NOTICE '092 rolled back: chat-attachments is PUBLIC again - this is a privacy regression, re-apply 092 as soon as the blocking issue is resolved.';
END $$;

COMMIT;
