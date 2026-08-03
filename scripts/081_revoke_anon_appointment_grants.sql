-- Revoke the anon privileges that Supabase's default-privileges rule silently
-- grants on every new public table.
--
-- 080 stated in a comment that anon is never granted anything on the appointment
-- tables, and then relied on that being true by default. It is not: Supabase ships
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, so both
-- tables were created with anon holding INSERT/SELECT/UPDATE/DELETE/TRUNCATE.
--
-- Nothing was actually reachable — RLS is enabled on both tables and every policy
-- 080 created targets `authenticated`, so anon matched no permissive policy and was
-- denied. This migration closes the gap anyway, because that safety depends on
-- nobody ever adding a `TO public` policy later. 074 already does exactly this for
-- share_links; 080 should have followed it.
--
-- Phase 2 adds an anonymous booking path, which reads via the service role after
-- validating a token (the /share/[token] pattern). That path bypasses RLS by design
-- and needs no anon grant, so revoking here does not block it.

BEGIN;

REVOKE ALL ON public.appointment_settings     FROM anon;
REVOKE ALL ON public.appointment_restrictions FROM anon;

-- Re-assert the intended grants, so this migration fully describes the end state
-- rather than depending on 080 having run first in the same shape.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_settings     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_restrictions TO authenticated;

COMMIT;
