-- 093: raise every upload limit to the maximum the plan allows.
--
-- Owner decision, 2026-08-12: "change everything to the max you can."
--
-- WHAT THE MAXIMUM ACTUALLY IS
-- 50 MB per file, and that is a **hard ceiling of the Supabase Free plan**, not a
-- configurable setting — a bucket's file_size_limit cannot exceed the project-wide
-- upload limit, and on Free that limit cannot be raised at all. Going above 50 MB
-- requires changing plan, not changing SQL. Total storage on Free is also capped at
-- 1 GB across all buckets, which is roughly 20 files at full size.
--
-- WHAT THIS CHANGES
-- `chat-attachments` was set to 10 MB by 092 with a deliberately narrowed MIME list
-- (no video, no design files). Both were judgement calls about chat being for quick
-- shares; the owner has overruled them. It now matches task-assets exactly: 50 MB and
-- the full shared allowlist including video, Photoshop and PostScript.
--
-- `task-assets` is already at 50 MB from 091 and is re-asserted here rather than
-- assumed, so this file states the whole intended end state in one place and the
-- post-conditions can prove it.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
-- The **inline base64 path** for task attachments stays at 10 MB (043's CHECK on
-- octet_length(file_data)). That limit is not protecting against the same thing: those
-- bytes go into the Postgres row, inflated 33% by base64, and the Free plan's DATABASE
-- budget is 500 MB in total — roughly seven 50 MB files would end the app, and every
-- one of them would also be pulled back through PostgREST as JSON on download. The
-- large-file toggle exists precisely so that path never has to grow. Raising it is not
-- "more maximum", it is the failure mode the whole feature was built to avoid.
--
-- Post-conditions run inside the transaction. Rollback: scripts/rollback/093_revert.sql

BEGIN;

CREATE TEMP TABLE _093_precheck ON COMMIT DROP AS
SELECT count(*) AS message_rows, count(image_url) AS legacy_url_rows
FROM public.chat_messages;

UPDATE storage.buckets
SET
  file_size_limit    = 52428800, -- 50 MB: the Supabase Free per-file ceiling.
  allowed_mime_types = ARRAY[
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
WHERE id IN ('chat-attachments', 'task-assets');

-- ---------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r             RECORD;
  v_before      BIGINT;
  v_after       BIGINT;
  v_legacy_b    BIGINT;
  v_legacy_a    BIGINT;
BEGIN
  FOR r IN
    SELECT id, public, file_size_limit, coalesce(array_length(allowed_mime_types, 1), 0) AS mimes
    FROM storage.buckets
    WHERE id IN ('chat-attachments', 'task-assets')
  LOOP
    IF r.file_size_limit IS DISTINCT FROM 52428800 THEN
      RAISE EXCEPTION '% file_size_limit is %, expected 52428800 (50 MB). Aborting.', r.id, r.file_size_limit;
    END IF;
    IF r.mimes <> 23 THEN
      RAISE EXCEPTION '% has % mime types, expected 23. Aborting.', r.id, r.mimes;
    END IF;
    -- Raising a limit must never quietly re-open a bucket to the public CDN.
    IF r.public IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION '% is public — 092 made it private and this migration must not undo that. Aborting.', r.id;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('chat-attachments', 'task-assets')) <> 2 THEN
    RAISE EXCEPTION 'Expected both task-assets and chat-attachments to exist. Aborting.';
  END IF;

  -- The inline base64 ceiling must be left exactly where 043 put it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_attachments'::regclass
      AND conname = 'task_attachments_file_data_size_check'
      AND pg_get_constraintdef(oid) LIKE '%14000000%'
  ) THEN
    RAISE EXCEPTION 'The inline base64 limit (043) is not intact — see this file''s header for why it must not move. Aborting.';
  END IF;

  SELECT message_rows, legacy_url_rows INTO v_before, v_legacy_b FROM _093_precheck;
  SELECT count(*), count(image_url) INTO v_after, v_legacy_a FROM public.chat_messages;
  IF v_before IS DISTINCT FROM v_after OR v_legacy_b IS DISTINCT FROM v_legacy_a THEN
    RAISE EXCEPTION 'chat_messages changed during a settings-only migration. Aborting.';
  END IF;

  RAISE NOTICE '093 verified: task-assets and chat-attachments both private, 50 MB, 23 mime types; inline base64 path unchanged.';
END $$;

COMMIT;
