-- 142: One question the Projects file route needs answered: may this signed-in person work with
-- Projects? Projects media now lives in Cloudflare R2, outside Supabase Storage and its policies,
-- so the server route asks the same function every Projects table policy already uses.
--
-- A thin wrapper because `private` is not exposed through the API. SECURITY INVOKER, so it runs as
-- the caller and `auth.uid()` is theirs. Purely additive: one function, nothing else changes.
-- Rollback: scripts/rollback/142_revert.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.marketing_projects_access()
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT private.can_manage_marketing_channels();
$$;

REVOKE ALL ON FUNCTION public.marketing_projects_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketing_projects_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.marketing_projects_access() TO authenticated;

COMMENT ON FUNCTION public.marketing_projects_access() IS
  'Same answer as private.can_manage_marketing_channels(), callable from the API. Gates the R2 file route for Projects.';

DO $post$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.marketing_projects_access()', 'EXECUTE') THEN
    RAISE EXCEPTION '142: authenticated must be able to run marketing_projects_access()';
  END IF;
  IF has_function_privilege('anon', 'public.marketing_projects_access()', 'EXECUTE') THEN
    RAISE EXCEPTION '142: anon must not be able to run marketing_projects_access()';
  END IF;
  RAISE NOTICE '142 verified: marketing_projects_access() ready for signed-in users only.';
END
$post$;

COMMIT;
