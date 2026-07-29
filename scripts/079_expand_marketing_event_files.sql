-- Expand event attachments from four image formats at 10 MB to the common
-- marketing asset formats at 50 MB. The Storage bucket and metadata table must
-- enforce the same allowlist so a successful object upload can always be linked.

BEGIN;

UPDATE storage.buckets
SET
  file_size_limit = 52428800,
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
WHERE id = 'marketing-assets';

ALTER TABLE public.marketing_calendar_attachments
  DROP CONSTRAINT IF EXISTS marketing_calendar_attachments_mime_type_check,
  DROP CONSTRAINT IF EXISTS marketing_calendar_attachments_file_size_check;

ALTER TABLE public.marketing_calendar_attachments
  ADD CONSTRAINT marketing_calendar_attachments_mime_type_check
    CHECK (
      mime_type IN (
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
      )
    ),
  ADD CONSTRAINT marketing_calendar_attachments_file_size_check
    CHECK (file_size > 0 AND file_size <= 52428800);

COMMIT;
