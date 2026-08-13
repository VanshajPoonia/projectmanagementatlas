-- Rollback for 095_revoke_anon_privileges.sql.
--
-- Restores Supabase's stock default-privilege posture: `anon` and `authenticated` get ALL on
-- every table/sequence/function in `public`, and new objects inherit that again.
--
-- ⚠️ This deliberately RE-OPENS the gap 095 closed. RLS still stands behind it (every public
-- table has RLS enabled and no policy admits a NULL auth.uid()), which is why the gap was
-- latent rather than live — but there is no good reason to run this except to unblock a
-- regression you have actually observed and can name.
--
-- If something broke after 095, prefer a targeted GRANT for the specific object over this
-- blanket revert. The likeliest genuine failure is an unauthenticated client that used to get
-- an empty array from RLS and now gets a 403 instead; the fix for that is in the client, not
-- in the grants.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it deliberately,
-- then delete 095's row from the ledger so it matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '095_revoke_anon_privileges.sql';

BEGIN;

-- 1. Tables ---------------------------------------------------------------------------------
DO $$
DECLARE
  rel RECORD;
BEGIN
  FOR rel IN
    SELECT c.oid::regclass AS ident
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('GRANT ALL ON %s TO anon, authenticated', rel.ident);
  END LOOP;
END $$;

-- 2. Sequences ------------------------------------------------------------------------------
DO $$
DECLARE
  seq RECORD;
BEGIN
  FOR seq IN
    SELECT c.oid::regclass AS ident
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO anon', seq.ident);
  END LOOP;
END $$;

-- 3. Functions ------------------------------------------------------------------------------
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS ident
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn.ident);
    -- Postgres's implicit default, which 095 revoked on the three functions that still had it.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', fn.ident);
  END LOOP;
END $$;

-- 4. Default privileges ----------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '095 revert: could not restore supabase_admin defaults (not a member)';
END $$;

COMMIT;
