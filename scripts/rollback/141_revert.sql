-- Reverts 141. Delete any video rows and their files first, or the bucket narrowing below leaves
-- them unreadable by type.
BEGIN;
DELETE FROM public.marketing_project_photos WHERE kind = 'video';
ALTER TABLE public.marketing_project_photos DROP COLUMN IF EXISTS duration_seconds, DROP COLUMN IF EXISTS kind;
UPDATE storage.buckets SET file_size_limit = 10485760, allowed_mime_types = ARRAY['image/jpeg'] WHERE id = 'marketing-projects';
COMMIT;
