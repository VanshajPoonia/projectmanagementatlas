-- 140: Projects on the Marketing tab. The marketing team (admins and calendar members, the same
-- set as the calendar and the Social media board) names a finished job, adds its best photos and
-- writes it up: area, business unit, completion date and a description.
--
-- Photos are shrunk in the browser before they upload, so the bucket takes JPEG only and each
-- file is capped at 10 MB. The first photo by position is the cover.
--
-- Purely additive: two new tables and one bucket. No module row, the tab follows the calendar.
-- Rollback: scripts/rollback/140_revert.sql

BEGIN;

DROP TABLE IF EXISTS _140_precheck;
CREATE TEMP TABLE _140_precheck AS
SELECT (SELECT count(*) FROM public.companies) AS company_rows;

CREATE TABLE IF NOT EXISTS public.marketing_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160 AND name ~ '\S'),
  -- SET NULL, not CASCADE: archiving or removing a business unit must not take a project with it.
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  area TEXT CHECK (area IS NULL OR char_length(area) <= 160),
  completed_on DATE,
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_projects_recent ON public.marketing_projects (created_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_project_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.marketing_projects(id) ON DELETE CASCADE,
  -- Storage path in the marketing-projects bucket: <project id>/<photo id>.jpg
  path TEXT NOT NULL UNIQUE,
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 500),
  -- Lowest position is the cover. Making a photo the cover gives it one less than the rest.
  position INTEGER NOT NULL DEFAULT 0,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  bytes INTEGER CHECK (bytes IS NULL OR bytes > 0),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_project_photos_project ON public.marketing_project_photos (project_id, position);

ALTER TABLE public.marketing_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_project_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_projects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_project_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_project_photos TO authenticated;

DROP POLICY IF EXISTS "Marketing team reads projects" ON public.marketing_projects;
CREATE POLICY "Marketing team reads projects" ON public.marketing_projects FOR SELECT
  TO authenticated USING (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team adds projects" ON public.marketing_projects;
CREATE POLICY "Marketing team adds projects" ON public.marketing_projects FOR INSERT
  TO authenticated WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team edits projects" ON public.marketing_projects;
CREATE POLICY "Marketing team edits projects" ON public.marketing_projects FOR UPDATE
  TO authenticated USING (private.can_manage_marketing_channels()) WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team removes projects" ON public.marketing_projects;
CREATE POLICY "Marketing team removes projects" ON public.marketing_projects FOR DELETE
  TO authenticated USING (private.can_manage_marketing_channels());

DROP POLICY IF EXISTS "Marketing team reads project photos" ON public.marketing_project_photos;
CREATE POLICY "Marketing team reads project photos" ON public.marketing_project_photos FOR SELECT
  TO authenticated USING (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team adds project photos" ON public.marketing_project_photos;
CREATE POLICY "Marketing team adds project photos" ON public.marketing_project_photos FOR INSERT
  TO authenticated WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team edits project photos" ON public.marketing_project_photos;
CREATE POLICY "Marketing team edits project photos" ON public.marketing_project_photos FOR UPDATE
  TO authenticated USING (private.can_manage_marketing_channels()) WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team removes project photos" ON public.marketing_project_photos;
CREATE POLICY "Marketing team removes project photos" ON public.marketing_project_photos FOR DELETE
  TO authenticated USING (private.can_manage_marketing_channels());

-- Private bucket. The browser sends JPEG only, already shrunk, so 10 MB is far above what lands.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketing-projects', 'marketing-projects', FALSE, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Marketing team reads project files" ON storage.objects;
CREATE POLICY "Marketing team reads project files" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'marketing-projects' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team uploads project files" ON storage.objects;
CREATE POLICY "Marketing team uploads project files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'marketing-projects' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team replaces project files" ON storage.objects;
CREATE POLICY "Marketing team replaces project files" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'marketing-projects' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team removes project files" ON storage.objects;
CREATE POLICY "Marketing team removes project files" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'marketing-projects' AND private.can_manage_marketing_channels());

DO $post$
DECLARE
  v_before BIGINT;
  v_count  BIGINT;
BEGIN
  SELECT company_rows INTO v_before FROM _140_precheck;
  SELECT count(*) INTO v_count FROM public.companies;
  IF v_count IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '140: companies changed, % -> %', v_before, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketing_projects';
  IF v_count <> 4 THEN RAISE EXCEPTION '140: expected 4 policies on marketing_projects, found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketing_project_photos';
  IF v_count <> 4 THEN RAISE EXCEPTION '140: expected 4 policies on marketing_project_photos, found %', v_count; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.marketing_projects'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.marketing_project_photos'::regclass) THEN
    RAISE EXCEPTION '140: RLS must be on for both tables';
  END IF;

  IF has_table_privilege('anon', 'public.marketing_projects', 'SELECT')
     OR has_table_privilege('anon', 'public.marketing_project_photos', 'SELECT') THEN
    RAISE EXCEPTION '140: anon must hold nothing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketing-projects' AND public = false) THEN
    RAISE EXCEPTION '140: the marketing-projects bucket must exist and be private';
  END IF;

  -- A blank name is refused, tried for real and rolled back.
  BEGIN
    INSERT INTO public.marketing_projects (name) VALUES (E' \t\n');
    RAISE EXCEPTION '140: a blank project name was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE '140 verified: marketing_projects + photos ready, RLS on, bucket private.';
END
$post$;

COMMIT;
