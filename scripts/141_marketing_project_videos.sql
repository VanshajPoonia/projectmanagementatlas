-- 141: Videos in Projects. A project's media can now be photos or videos. The browser shrinks a
-- video to MP4 before it uploads, so the bucket takes video/mp4 beside JPEG. 50 MB is the most any
-- one file can be on the Supabase Free plan, and the browser squeezes every video to fit under it.
--
-- A video's poster frame is a JPEG stored next to it: <project id>/<media id>.jpg beside
-- <project id>/<media id>.mp4. It is not a row of its own, so the schema only needs a kind.
--
-- Purely additive: two nullable-or-defaulted columns and a wider bucket. Existing rows are photos.
-- Rollback: scripts/rollback/141_revert.sql

BEGIN;

ALTER TABLE public.marketing_project_photos
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video')),
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC CHECK (duration_seconds IS NULL OR duration_seconds >= 0);

UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'video/mp4']
WHERE id = 'marketing-projects';

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'marketing_project_photos' AND column_name = 'kind'
  ) THEN
    RAISE EXCEPTION '141: marketing_project_photos.kind is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'marketing-projects' AND public = false AND 'video/mp4' = ANY (allowed_mime_types)
  ) THEN
    RAISE EXCEPTION '141: the marketing-projects bucket must stay private and take video/mp4';
  END IF;

  RAISE NOTICE '141 verified: projects take videos, bucket private.';
END
$post$;

COMMIT;
