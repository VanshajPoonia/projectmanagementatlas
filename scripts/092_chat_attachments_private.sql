-- 092: close the chat-attachments hole — private bucket, real limits, and
-- attachments scoped to the two people in the conversation.
--
-- THE PROBLEM
-- `chat-attachments` was created by 002 as `public = true`, with no file_size_limit
-- and no allowed_mime_types. A public bucket is served straight off the Storage CDN
-- and RLS does NOT apply to reads, so every direct-message attachment was readable
-- by anyone holding the URL — no session, no account. The client then stored exactly
-- that public URL in chat_messages.image_url, which is a link to a private DM
-- attachment that works for anybody it is ever forwarded to. On top of that, with no
-- size or type limit, any authenticated user could push an arbitrarily large file of
-- any type into the project's shared storage budget.
--
-- The SELECT policy 002 created ("Users can view all chat attachments") was also
-- wider than a DM feature wants: it let ANY authenticated user read — and list —
-- every chat attachment in the bucket, not just their own conversations. On the dev
-- sandbox all three of 002's policies had additionally gone missing at some point,
-- so chat upload was simply broken there; prod still had them. This migration makes
-- both databases converge on the same, correct set.
--
-- WHY THIS IS SAFE TO APPLY NOW
-- Nothing references a chat attachment. Verified against BOTH databases immediately
-- before writing this: prod has 6 chat_messages with 0 non-null image_url, dev has 4
-- with 0. Each database holds exactly one orphaned object (~399 kB) that no message
-- points at. So flipping the bucket to private cannot break a link that someone can
-- currently follow — there are none — and no backfill of existing rows is needed.
-- The two orphaned objects are deliberately left in place rather than deleted: they
-- are user data this migration has no mandate to destroy, and once the bucket is
-- private they are unreachable except by their own uploader.
--
-- THE SHAPE
-- Attachments stop being addressed by public URL and start being addressed by
-- storage path (`chat_messages.attachment_path`), the same way task and marketing
-- assets already work. The client signs a short-lived URL to render them. The new
-- SELECT policy ties an object to the conversation it was sent in, so only the
-- sender, the recipient, and admins can read it — the uploader-owns-folder clause
-- additionally covers the window between the object landing and the message row
-- being inserted, and lets an upload whose message insert failed still be cleaned up.
--
-- The legacy image_url column is kept (it is how any pre-existing row would have been
-- rendered) but is no longer written by the client.
--
-- No REVOKE block is needed: this creates no new table in public, and ADD COLUMN
-- inherits the grants already on chat_messages.
--
-- Post-conditions run inside the transaction. Paired rollback:
-- scripts/rollback/092_revert.sql

BEGIN;

CREATE TEMP TABLE _092_precheck ON COMMIT DROP AS
SELECT
  count(*)                  AS message_rows,
  count(image_url)          AS legacy_url_rows
FROM public.chat_messages;

-- ---------------------------------------------------------------------------
-- 1. The bucket: private, size-capped, type-restricted.
--    10 MB rather than the 50 MB task-attachment ceiling — chat is for quick
--    shares, and the Free plan's whole storage budget is 1 GB.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET
  public             = FALSE,
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

-- ---------------------------------------------------------------------------
-- 2. Address attachments by path instead of public URL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS attachment_path TEXT;

-- The SELECT policy below looks an object up by this column on every read.
CREATE INDEX IF NOT EXISTS idx_chat_messages_attachment_path
  ON public.chat_messages(attachment_path)
  WHERE attachment_path IS NOT NULL;

COMMENT ON COLUMN public.chat_messages.attachment_path IS
  'Storage path in the private chat-attachments bucket, format <sender_id>/<uuid>.<ext>. '
  'Replaces image_url, which held a public CDN URL back when the bucket was public.';

-- ---------------------------------------------------------------------------
-- 3. Object policies. Dropped by both their 002 names and the new ones so this
--    is idempotent whether or not the database still has 002's set.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view all chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Upload own chat attachment objects" ON storage.objects;
DROP POLICY IF EXISTS "View chat attachment objects in own conversations" ON storage.objects;
DROP POLICY IF EXISTS "Delete own chat attachment objects" ON storage.objects;

-- Unchanged in effect from 002: you may only write into your own folder.
CREATE POLICY "Upload own chat attachment objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (SELECT auth.uid())::TEXT = (storage.foldername(name))[1]
  );

-- Narrowed from 002's "any authenticated user can read every chat attachment".
-- The participant test is written out explicitly rather than leaning on
-- chat_messages' own RLS applying to this sub-select — it mirrors that policy
-- (sender OR recipient OR admin) and does not depend on nested-RLS semantics.
CREATE POLICY "View chat attachment objects in own conversations"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      -- The uploader, which also covers the gap between the object landing and
      -- the chat_messages row that references it being inserted.
      (SELECT auth.uid())::TEXT = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM public.chat_messages m
        WHERE m.attachment_path = storage.objects.name
          AND (
            m.sender_id = (SELECT auth.uid())
            OR m.recipient_id = (SELECT auth.uid())
            OR private.is_admin_user()
          )
      )
    )
  );

-- Unchanged in effect from 002.
CREATE POLICY "Delete own chat attachment objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (SELECT auth.uid())::TEXT = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_public      BOOLEAN;
  v_limit       BIGINT;
  v_mimes       INT;
  v_policies    INT;
  v_before      BIGINT;
  v_after       BIGINT;
  v_legacy_b    BIGINT;
  v_legacy_a    BIGINT;
BEGIN
  SELECT public, file_size_limit, coalesce(array_length(allowed_mime_types, 1), 0)
    INTO v_public, v_limit, v_mimes
  FROM storage.buckets WHERE id = 'chat-attachments';

  IF v_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'chat-attachments is still public — the hole this migration exists to close. Aborting.';
  END IF;
  IF v_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'chat-attachments file_size_limit is %, expected 10485760. Aborting.', v_limit;
  END IF;
  IF v_mimes < 1 THEN
    RAISE EXCEPTION 'chat-attachments has no MIME allowlist. Aborting.';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN (
      'Upload own chat attachment objects',
      'View chat attachment objects in own conversations',
      'Delete own chat attachment objects'
    );
  IF v_policies <> 3 THEN
    RAISE EXCEPTION 'Expected 3 chat-attachment object policies, found %. Aborting.', v_policies;
  END IF;

  -- 002's over-wide SELECT policy must be gone, not merely shadowed: storage.objects
  -- policies are PERMISSIVE, so leaving it in place would OR the restriction away.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can view all chat attachments'
  ) THEN
    RAISE EXCEPTION '002 blanket-read policy still present; it would OR away the new scoping. Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages'
      AND column_name = 'attachment_path'
  ) THEN
    RAISE EXCEPTION 'chat_messages.attachment_path was not created. Aborting.';
  END IF;

  -- No message may be touched: this migration adds a column and rewrites policies.
  SELECT message_rows, legacy_url_rows INTO v_before, v_legacy_b FROM _092_precheck;
  SELECT count(*), count(image_url) INTO v_after, v_legacy_a FROM public.chat_messages;
  IF v_before IS DISTINCT FROM v_after OR v_legacy_b IS DISTINCT FROM v_legacy_a THEN
    RAISE EXCEPTION
      'chat_messages changed during an additive migration (rows % -> %, legacy urls % -> %). Aborting.',
      v_before, v_after, v_legacy_b, v_legacy_a;
  END IF;

  RAISE NOTICE '092 verified: chat-attachments private, 10 MB cap, % mime types, 3 scoped policies, % messages untouched (% legacy urls).',
    v_mimes, v_after, v_legacy_a;
END $$;

COMMIT;
