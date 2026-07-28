-- Cover the uploader foreign key so profile deletion does not scan the whole
-- marketing attachment table when PostgreSQL applies ON DELETE SET NULL.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_marketing_calendar_attachments_uploaded_by
  ON public.marketing_calendar_attachments(uploaded_by);

COMMIT;
