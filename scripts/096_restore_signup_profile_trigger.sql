-- 096_restore_signup_profile_trigger.sql
--
-- Restores the `on_auth_user_created` trigger on auth.users, which creates a public.profiles
-- row whenever an account signs up.
--
-- HOW THIS WAS FOUND. 095's harness asserted that signup still creates a profiles row (a claim
-- worth proving, since 095 revoked the implicit EXECUTE TO PUBLIC on handle_new_user). It
-- failed. The cause was not 095 — that migration only touches grants and default privileges and
-- never mentions triggers. `pg_trigger` simply had **no** trigger calling handle_new_user at
-- all: the function existed, orphaned, calling nothing.
--
-- SCOPE: this is DEV-SANDBOX DRIFT, not a production regression. Checked, don't re-litigate:
-- production has 11 auth accounts and 10 profiles rows, and the five most recently created
-- accounts (June-July 2026) all have their profiles row, so the trigger is firing there. The
-- cause fits the shape of the drift exactly — the trigger lives on `auth.users`, which is
-- OUTSIDE the `public` schema, so a sandbox clone taken of `public` alone recreates every
-- table, policy and function while silently dropping this one trigger. The orphaned function
-- surviving with no trigger attached is the fingerprint of that.
--
-- On prod this migration is therefore a harmless no-op (DROP IF EXISTS + CREATE re-creates the
-- identical trigger). It is worth applying anyway so both databases are provably in the same
-- state rather than assumed to be.
--
-- Prod's one pre-existing orphan is `cami@goatlasgo.us` (created 2026-01-21, never signed in):
-- an auth account with no profiles row. It predates this and is NOT created by this migration;
-- deciding whether to give it a profile or delete the account is the owner's call.
--
-- To re-check either database:
--     SELECT tgname, tgenabled FROM pg_trigger
--     WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--
-- Related fix shipped alongside: app/api/admin/create-user/route.ts used a bare
-- .update().eq() on profiles, which silently assumed this trigger had already inserted the row.
-- A zero-row UPDATE is not an error in PostgREST, so on any database missing the trigger that
-- route reported success while creating an account with no profile. It now upserts and checks
-- that a row came back.
--
-- The function body is left EXACTLY as 007 defined it, including its hardcoded
-- 'bobby@goatlasgo.us' -> 'admin' branch. That branch is dead in practice (Bobby's account
-- exists and is super_admin; the trigger only fires for brand-new rows) and de-hardcoding it is
-- a separate decision, not something to smuggle into a repair.
--
-- Purely additive: creates a trigger, changes no data, touches no policy. Paired rollback:
-- scripts/rollback/096_revert.sql

BEGIN;

-- 0. Preconditions ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION '096: public.handle_new_user() is missing — apply 007 first';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION '096: public.profiles is missing';
  END IF;
END $$;

-- 1. Re-attach the trigger --------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Post-conditions ---------------------------------------------------------------------------
DO $$
DECLARE
  trg_count INT;
  trg_enabled CHAR;
BEGIN
  SELECT count(*) INTO trg_count
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE t.tgrelid = 'auth.users'::regclass
    AND NOT t.tgisinternal
    AND pn.nspname = 'public'
    AND p.proname = 'handle_new_user';
  IF trg_count <> 1 THEN
    RAISE EXCEPTION '096 post-condition: expected exactly 1 signup trigger, found %', trg_count;
  END IF;

  SELECT t.tgenabled INTO trg_enabled
  FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created';
  IF trg_enabled <> 'O' THEN
    RAISE EXCEPTION '096 post-condition: trigger exists but is not enabled (tgenabled=%)', trg_enabled;
  END IF;

  -- 095 revoked handle_new_user's implicit EXECUTE TO PUBLIC. authenticated must still hold its
  -- explicit grant, and the trigger fires as SECURITY DEFINER regardless — assert the function
  -- is still SECURITY DEFINER, since without that it would hit profiles' RLS and fail.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '096 post-condition: handle_new_user is no longer SECURITY DEFINER';
  END IF;

  RAISE NOTICE '096 OK — signup trigger restored and enabled on auth.users';
END $$;

COMMIT;
