-- 095_revoke_anon_privileges.sql
--
-- Closes the standing Supabase default-grant gap described in CLAUDE.md, and fixes the root
-- cause so it stops recurring.
--
-- THE PROBLEM. Supabase ships default privileges that grant `anon` and `authenticated` ALL on
-- every new table/sequence/function in `public`. Measured 2026-08-13 on the dev sandbox: `anon`
-- held full privileges (including TRUNCATE) on 30 of 37 tables. Only the migrations that
-- remembered an explicit REVOKE (082 appointments, 090 project_ids, 094 teams) were clean.
--
-- THIS WAS NOT A LIVE LEAK, and this migration is not an incident response:
--   * every one of the 37 tables has RLS enabled (the `rls_auto_enable` event trigger sees to
--     that), and all 12 policies written against the `{public}` role are gated on auth.uid(),
--     so a signed-out caller passes none of them;
--   * PostgREST does not expose TRUNCATE.
-- It is defence in depth. Today RLS is the *only* layer, and it is correct by habit rather than
-- by construction: the next policy written `USING (true)` without `TO authenticated` would
-- expose its table outright, and TRUNCATE is never subject to RLS at any time.
--
-- WHY A BLANKET REVOKE FOR anon IS SAFE HERE. Every public, unauthenticated surface in this app
-- talks to Postgres through the **service role** on the server, not through `anon`:
-- app/share/[token], app/book/[token], app/book/cancel/[token], app/api/book/*. No RLS policy
-- anywhere targets the `anon` role. And the proof is already in the database: the tables behind
-- those public flows (`share_links`, `appointments`, `appointment_booking_links`) ALREADY have
-- anon revoked, and `pnpm check:appointment-booking` passes against them today.
--
-- ⚠️ WHAT IS DELIBERATELY LEFT ALONE.
--   1. `authenticated` keeps every DML privilege it currently holds on every table. Re-deriving
--      per-table SELECT/INSERT/UPDATE/DELETE would risk breaking a feature to no benefit — RLS
--      is what actually constrains a signed-in user. Only TRUNCATE/REFERENCES/TRIGGER are taken
--      away, and no PostgREST path can ever use those.
--   2. `service_role` and `postgres` are untouched.
--   3. **The three public booking RPCs keep their anon EXECUTE**, which `082` granted on
--      purpose: `book_appointment`, `cancel_appointment`, `check_booking_rate_limit`.
--      app/api/book/cancel/[token]/route.ts really does call `cancel_appointment` with an anon
--      client. A post-condition below asserts all three survive, so this migration fails loudly
--      rather than silently breaking public booking.
--
-- Self-verifying per the repo convention. Paired rollback: scripts/rollback/095_revert.sql

BEGIN;

-- 1. Tables ---------------------------------------------------------------------------------
DO $$
DECLARE
  rel RECORD;
BEGIN
  FOR rel IN
    SELECT c.oid::regclass AS ident
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM anon', rel.ident);
    -- TRUNCATE bypasses RLS entirely; REFERENCES/TRIGGER are DDL-adjacent. No API path uses any
    -- of the three. Every DML privilege authenticated holds is left exactly as it was.
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated', rel.ident);
  END LOOP;
END $$;

-- 2. Sequences ------------------------------------------------------------------------------
DO $$
DECLARE
  seq RECORD;
BEGIN
  FOR seq IN
    SELECT c.oid::regclass AS ident
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', seq.ident);
  END LOOP;
END $$;

-- 3. Functions ------------------------------------------------------------------------------
-- Three SECURITY DEFINER helpers are executable by anon, and NOT via a grant to the `anon` role
-- — via Postgres's own implicit `EXECUTE TO PUBLIC` on every new function. Their ACLs carry a
-- leading `=X/postgres` entry, which is the PUBLIC grant, so `REVOKE ... FROM anon` alone is a
-- no-op on them. That is what the post-condition caught on the first run of this migration.
--
--   is_board_member(uuid,uuid) -> bool           the one genuinely reachable over PostgREST
--   handle_new_user()          -> trigger        fires from the auth.users trigger
--   rls_auto_enable()          -> event_trigger  fires from a DDL event trigger
--
-- Revoking PUBLIC is safe for all three because each ALSO holds an explicit `authenticated=X`
-- grant, which survives. And trigger/event-trigger functions do not have EXECUTE checked when
-- they fire (that is checked at CREATE TRIGGER time), so signup keeps working — verified by a
-- real signUp through the anon key in the harness.
--
-- Every other function in `public` already had PUBLIC revoked and an explicit grant (082, 088,
-- 090 all got this right), so the loop is a no-op on them.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS ident
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- The intentional public-booking surface from 082. Do not touch: an anon client really
      -- does call cancel_appointment (app/api/book/cancel/[token]/route.ts).
      AND p.proname NOT IN ('book_appointment', 'cancel_appointment', 'check_booking_rate_limit')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.ident);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.ident);
  END LOOP;
END $$;

-- 4. Root cause: stop new objects inheriting the grant --------------------------------------
-- Without this, the very next CREATE TABLE re-opens everything above. `authenticated` keeps its
-- default DML on new tables so the existing migration workflow is unchanged — only anon's
-- default, and authenticated's TRUNCATE/REFERENCES/TRIGGER, are withdrawn.
--
-- Defaults are per-granting-role. Migrations here connect as `postgres`, which is the path that
-- matters; `supabase_admin` is what the Supabase dashboard uses, and `postgres` may not be
-- permitted to alter its defaults, so that half is attempted and reported rather than required.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  RAISE NOTICE '095: supabase_admin default privileges narrowed too';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '095: could not alter supabase_admin defaults (not a member) — tables created via the Supabase DASHBOARD will still grant anon and need a manual REVOKE. Migrations run as postgres and are covered.';
END $$;

-- 5. Post-conditions -------------------------------------------------------------------------
DO $$
DECLARE
  anon_table_privs INT;
  anon_seq_privs INT;
  auth_truncate INT;
  rls_off INT;
  booking_rpcs INT;
  leaky_helper BOOLEAN;
  core_readable INT;
BEGIN
  -- anon holds nothing on any table.
  SELECT count(*) INTO anon_table_privs
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon';
  IF anon_table_privs <> 0 THEN
    RAISE EXCEPTION '095: anon still holds % table privilege(s) in public', anon_table_privs;
  END IF;

  -- ...nor on any sequence.
  -- `OFFSET 0` is an optimization fence. Without it the planner is free to evaluate
  -- has_sequence_privilege() before the relkind filter, and it then errors on the first index
  -- it meets ("saml_providers_pkey is not a sequence"). Same reason on the TRUNCATE check below.
  SELECT count(*) INTO anon_seq_privs
  FROM (
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
    OFFSET 0
  ) s
  WHERE has_sequence_privilege('anon', s.oid, 'USAGE');
  IF anon_seq_privs <> 0 THEN
    RAISE EXCEPTION '095: anon still holds USAGE on % sequence(s)', anon_seq_privs;
  END IF;

  -- authenticated cannot TRUNCATE anything (the one privilege RLS never constrains).
  SELECT count(*) INTO auth_truncate
  FROM (
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    OFFSET 0
  ) t
  WHERE has_table_privilege('authenticated', t.oid, 'TRUNCATE');
  IF auth_truncate <> 0 THEN
    RAISE EXCEPTION '095: authenticated can still TRUNCATE % table(s)', auth_truncate;
  END IF;

  -- RLS is still the primary layer everywhere. This migration must not have disturbed it.
  SELECT count(*) INTO rls_off
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF rls_off <> 0 THEN
    RAISE EXCEPTION '095: RLS is disabled on % public table(s)', rls_off;
  END IF;

  -- ⚠️ The public booking surface MUST survive. 082 granted these to anon on purpose and
  -- app/api/book/cancel/[token]/route.ts calls one of them with an anon client.
  SELECT count(*) INTO booking_rpcs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('book_appointment', 'cancel_appointment', 'check_booking_rate_limit')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF booking_rpcs <> 3 THEN
    RAISE EXCEPTION '095: public booking would break — only % of 3 booking RPCs are still anon-executable', booking_rpcs;
  END IF;

  -- The one helper that was genuinely reachable by anon is not any more.
  SELECT has_function_privilege('anon', p.oid, 'EXECUTE') INTO leaky_helper
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_board_member' LIMIT 1;
  IF coalesce(leaky_helper, false) THEN
    RAISE EXCEPTION '095: is_board_member is still anon-executable';
  END IF;

  -- The app must still work: signed-in users keep SELECT on the core tables.
  SELECT count(*) INTO core_readable
  FROM (VALUES ('tasks'), ('boards'), ('profiles'), ('columns'), ('task_comments'),
               ('personal_tasks'), ('marketing_calendar_items'), ('teams')) AS t(name)
  WHERE has_table_privilege('authenticated', ('public.' || t.name)::regclass, 'SELECT');
  IF core_readable <> 8 THEN
    RAISE EXCEPTION '095: authenticated lost SELECT somewhere — only % of 8 core tables readable', core_readable;
  END IF;

  RAISE NOTICE '095 OK — anon revoked everywhere, booking RPCs intact, RLS untouched, authenticated DML preserved';
END $$;

COMMIT;
