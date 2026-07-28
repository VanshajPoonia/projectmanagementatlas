-- Give every marketing calendar event one private, downloadable social image.
-- The object itself lives in Supabase Storage; this table keeps only the event
-- link and display metadata. Storage paths begin with the parent item UUID so
-- object policies can enforce the same assigned-user/admin access as the sheet.

BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'marketing-assets',
  'marketing-assets',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.marketing_calendar_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE
    REFERENCES public.marketing_calendar_items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_calendar_attachments_item
  ON public.marketing_calendar_attachments(item_id);

ALTER TABLE public.marketing_calendar_attachments ENABLE ROW LEVEL SECURITY;

-- New public-schema tables are no longer guaranteed to be exposed to the Data
-- API automatically, so grant the authenticated role explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.marketing_calendar_attachments TO authenticated;

DROP POLICY IF EXISTS "View images for visible marketing events"
  ON public.marketing_calendar_attachments;
CREATE POLICY "View images for visible marketing events"
  ON public.marketing_calendar_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "Attach images to visible marketing events"
  ON public.marketing_calendar_attachments;
CREATE POLICY "Attach images to visible marketing events"
  ON public.marketing_calendar_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "Replace images on visible marketing events"
  ON public.marketing_calendar_attachments;
CREATE POLICY "Replace images on visible marketing events"
  ON public.marketing_calendar_attachments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  )
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "Remove images from visible marketing events"
  ON public.marketing_calendar_attachments;
CREATE POLICY "Remove images from visible marketing events"
  ON public.marketing_calendar_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id = item_id
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "View marketing event image objects" ON storage.objects;
CREATE POLICY "View marketing event image objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "Upload marketing event image objects" ON storage.objects;
CREATE POLICY "Upload marketing event image objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

DROP POLICY IF EXISTS "Delete marketing event image objects" ON storage.objects;
CREATE POLICY "Delete marketing event image objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'marketing-assets'
    AND EXISTS (
      SELECT 1
      FROM public.marketing_calendar_items item
      WHERE item.id::TEXT = (storage.foldername(name))[1]
        AND (
          item.assigned_to = (SELECT auth.uid())
          OR private.is_admin_user()
        )
    )
  );

COMMIT;
