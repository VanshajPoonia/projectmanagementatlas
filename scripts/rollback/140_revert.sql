-- Revert 140 (Projects on the Marketing tab).
--
-- ⚠️ DESTROYS DATA: every project and photo row goes with the tables. Uploaded files stay in the
-- marketing-projects bucket until removed from Storage; delete them there first if wanted.

BEGIN;

DROP POLICY IF EXISTS "Marketing team reads project files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team uploads project files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team replaces project files" ON storage.objects;
DROP POLICY IF EXISTS "Marketing team removes project files" ON storage.objects;

DROP TABLE IF EXISTS public.marketing_project_photos;
DROP TABLE IF EXISTS public.marketing_projects;

COMMIT;
