-- 094_teams_seed_and_super_admin_management.sql
--
-- Teams go live. Migration 064 created `teams`/`team_members` and then nothing ever wrote to
-- them: verified 2026-08-13 against BOTH the dev sandbox and production — 0 rows in each, and
-- zero call sites anywhere in the repo. So this is a first population, not a reconciliation of
-- drifted data, and there is no existing membership for it to contradict.
--
-- What it does:
--   1. Makes team names unique, so seeding is idempotent and the UI can reject duplicates.
--   2. Seeds the two business units the company already runs on: 'Atlas General Contracting'
--      and 'Shanks Realty Group'. Names and colors match the `companies` rows seeded by 056,
--      but this is deliberately NOT an FK to companies — CLAUDE.md's standing ruling is that
--      `companies` is a marketing business-unit label and must not be overloaded into org
--      structure. The names agree today; the two concepts stay free to diverge.
--   3. Puts every existing profile in BOTH teams (owner's instruction, 2026-08-13).
--   4. Narrows team management from private.is_admin_user() (admin + super_admin) to
--      private.is_super_admin_user() (super_admin only). The owner asked for super admins
--      specifically, and the Super Admin page is already the super-admin-only home for exactly
--      this kind of entity management (companies, users, statuses). Note this is a NARROWING:
--      Tim/Kogan/Mendy (plain admins) lose a capability they had on paper but never had a UI
--      for, since no UI ever consumed these tables.
--   5. Closes the Supabase default-grant hole on these two tables. 064 granted narrowly but
--      never revoked the blanket ALL that Supabase hands `anon`/`authenticated` on every new
--      table in `public` — the trap CLAUDE.md documents and 090 is the worked example of.
--      RLS was already denying anon (no policy admits a NULL auth.uid()), so this is closing
--      a latent hole, not an active leak.
--
-- Self-verifying per the repo convention: the post-conditions at the bottom run inside the
-- same transaction, so a partial application rolls back instead of half-landing.
-- Paired rollback: scripts/rollback/094_revert.sql

BEGIN;

-- 0. Preconditions -----------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.teams') IS NULL OR to_regclass('public.team_members') IS NULL THEN
    RAISE EXCEPTION '094: teams/team_members are missing — apply 064 first';
  END IF;
  IF to_regprocedure('private.is_super_admin_user()') IS NULL THEN
    RAISE EXCEPTION '094: private.is_super_admin_user() is missing — apply 069 first';
  END IF;
END $$;

-- 1. One team per name -------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name ON public.teams (lower(name));

-- 2. Seed the two business units ----------------------------------------------------------
INSERT INTO public.teams (name, color, position) VALUES
  ('Atlas General Contracting', '#7c3aed', 0),
  ('Shanks Realty Group',       '#e91e8c', 1)
ON CONFLICT (lower(name)) DO NOTHING;

-- 3. Every existing person joins both teams ------------------------------------------------
-- Deliberately unfiltered: no email-pattern guessing about which accounts are "real". Any
-- account that shouldn't be here (e.g. leftover test profiles) is removed through the Super
-- Admin > Teams UI this migration ships alongside, which is what that UI is for.
INSERT INTO public.team_members (team_id, user_id)
SELECT t.id, p.id
FROM public.teams t
CROSS JOIN public.profiles p
WHERE t.name IN ('Atlas General Contracting', 'Shanks Realty Group')
ON CONFLICT (team_id, user_id) DO NOTHING;

-- 4. Privileges: revoke Supabase's blanket default, then re-grant narrowly ------------------
REVOKE ALL ON public.teams        FROM anon, authenticated;
REVOKE ALL ON public.team_members FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams        TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.team_members TO authenticated;

-- 5. Management narrows to super admins ----------------------------------------------------
-- The "Everyone can view ..." SELECT policies from 064 are intentionally left in place:
-- Postgres ORs permissive policies together, so every signed-in user keeps read access while
-- only super admins pass the management policy for INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "Admins manage teams" ON public.teams;
DROP POLICY IF EXISTS "Super admins manage teams" ON public.teams;
CREATE POLICY "Super admins manage teams"
  ON public.teams FOR ALL
  TO authenticated
  USING (private.is_super_admin_user())
  WITH CHECK (private.is_super_admin_user());

DROP POLICY IF EXISTS "Admins manage team memberships" ON public.team_members;
DROP POLICY IF EXISTS "Super admins manage team memberships" ON public.team_members;
CREATE POLICY "Super admins manage team memberships"
  ON public.team_members FOR ALL
  TO authenticated
  USING (private.is_super_admin_user())
  WITH CHECK (private.is_super_admin_user());

-- 6. Post-conditions -----------------------------------------------------------------------
DO $$
DECLARE
  seeded_teams INT;
  profiles_total INT;
  expected_memberships INT;
  actual_memberships INT;
  anon_privs INT;
  manage_policies INT;
  view_policies INT;
BEGIN
  -- Both business units exist.
  SELECT count(*) INTO seeded_teams
  FROM public.teams
  WHERE name IN ('Atlas General Contracting', 'Shanks Realty Group');
  IF seeded_teams <> 2 THEN
    RAISE EXCEPTION '094 post-condition: expected both seeded teams, found %', seeded_teams;
  END IF;

  -- Every profile is in both of them.
  SELECT count(*) INTO profiles_total FROM public.profiles;
  expected_memberships := profiles_total * 2;
  SELECT count(*) INTO actual_memberships
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE t.name IN ('Atlas General Contracting', 'Shanks Realty Group');
  IF actual_memberships <> expected_memberships THEN
    RAISE EXCEPTION '094 post-condition: expected % memberships (% profiles x 2), found %',
      expected_memberships, profiles_total, actual_memberships;
  END IF;

  -- RLS still on for both tables.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.teams'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.team_members'::regclass) THEN
    RAISE EXCEPTION '094 post-condition: RLS is not enabled on teams/team_members';
  END IF;

  -- anon holds nothing at all on either table.
  SELECT count(*) INTO anon_privs
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('teams', 'team_members')
    AND grantee = 'anon';
  IF anon_privs <> 0 THEN
    RAISE EXCEPTION '094 post-condition: anon still holds % privilege(s) on teams tables', anon_privs;
  END IF;

  -- Exactly the intended policy set: one management policy and one view policy per table.
  SELECT count(*) INTO manage_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('teams', 'team_members')
    AND policyname LIKE 'Super admins manage%';
  IF manage_policies <> 2 THEN
    RAISE EXCEPTION '094 post-condition: expected 2 super-admin management policies, found %', manage_policies;
  END IF;

  SELECT count(*) INTO view_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('teams', 'team_members')
    AND cmd = 'SELECT';
  IF view_policies <> 2 THEN
    RAISE EXCEPTION '094 post-condition: expected 2 view policies (read access lost?), found %', view_policies;
  END IF;

  -- No stale admin-tier policy left behind.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('teams', 'team_members')
      AND policyname LIKE 'Admins manage%'
  ) THEN
    RAISE EXCEPTION '094 post-condition: the old admin-tier management policy survived';
  END IF;

  RAISE NOTICE '094 OK — 2 teams, % memberships, super-admin management, anon revoked', actual_memberships;
END $$;

COMMIT;
