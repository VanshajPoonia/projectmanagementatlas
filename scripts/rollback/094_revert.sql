-- Rollback for 094_teams_seed_and_super_admin_management.sql.
--
-- Restores the pre-094 state exactly: 064's admin-tier management policies, 064's grants,
-- and empty teams/team_members tables (which is what both dev and prod actually held before
-- 094 - verified 0 rows in each on 2026-08-13, so deleting the seed loses nothing that
-- predates this migration).
--
-- ⚠️ The DELETEs below are unconditional. If anyone has created their own teams or moved
-- members around since 094 landed, that work is destroyed. Comment out section 1 if you only
-- want the policy/grant revert.
--
-- Running this also puts the Super Admin > Teams tab in front of an empty table: the UI
-- tolerates it (it renders its empty state), but plain admins regain table-level management
-- rights they cannot reach any UI for.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it deliberately,
-- then delete 094's row from the ledger so it matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '094_teams_seed_and_super_admin_management.sql';

BEGIN;

-- 1. Undo the seed ------------------------------------------------------------------------
DELETE FROM public.team_members
WHERE team_id IN (
  SELECT id FROM public.teams
  WHERE name IN ('Atlas General Contracting', 'Shanks Realty Group')
);
DELETE FROM public.teams
WHERE name IN ('Atlas General Contracting', 'Shanks Realty Group');

DROP INDEX IF EXISTS public.idx_teams_name;

-- 2. Restore 064's admin-tier management policies -------------------------------------------
DROP POLICY IF EXISTS "Super admins manage teams" ON public.teams;
CREATE POLICY "Admins manage teams"
  ON public.teams FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

DROP POLICY IF EXISTS "Super admins manage team memberships" ON public.team_members;
CREATE POLICY "Admins manage team memberships"
  ON public.team_members FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

-- 3. Restore 064's grants -------------------------------------------------------------------
-- 064 never revoked Supabase's blanket default, so a faithful revert re-grants it. This is
-- the latent hole 094 closed; it is restored only to keep the revert honest.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.teams TO anon;
GRANT ALL ON public.team_members TO anon;

COMMIT;
