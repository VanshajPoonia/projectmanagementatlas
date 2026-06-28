-- 042_restrict_public_read_policies.sql
-- Security audit finding: two SELECT policies were scoped to {public} (i.e. also
-- the unauthenticated `anon` role) with USING(true), combined with Supabase's
-- default anon GRANT on every table. Confirmed live: an anonymous request with
-- only the public anon key (no login) could read every row of:
--   - public.profiles        (every user's name, email, admin/user role)
--   - public.allowed_emails  (the signup whitelist incl. external contacts)
--
-- Fix: re-scope both to {authenticated}. profiles stays readable by any logged-in
-- user (legitimate: assignee pickers, chat, calendar, reports all need the full
-- roster) but no longer by anonymous requests. allowed_emails is further
-- restricted to admins only, matching its existing INSERT/UPDATE/DELETE policies
-- — its only legitimate reader is the admin "Add User" panel
-- (components/admin/user-management.tsx).
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/042_restrict_public_read_policies.sql

BEGIN;

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anyone can view allowed emails" ON public.allowed_emails;
CREATE POLICY "Admins can view allowed emails"
  ON public.allowed_emails FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

COMMIT;

-- Verification: confirm neither policy is reachable by anon/public anymore
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('profiles', 'allowed_emails') AND cmd = 'SELECT';
