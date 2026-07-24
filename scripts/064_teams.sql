-- Teams (PROMPT 3, single-org reinterpretation — see CLAUDE.md's single-org ruling, 2026-07-24).
-- Lightweight internal groupings within the one organization (e.g. Marketing, Ops) — NOT a
-- tenancy concept. Purely additive: empty until created via the UI, no backfill guess here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members(user_id);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.team_members TO authenticated;

-- Small single-org company: everyone can see all teams/memberships (matches how
-- boards/tags/task_statuses are already globally readable). Only admins manage them.
DROP POLICY IF EXISTS "Everyone can view teams" ON public.teams;
CREATE POLICY "Everyone can view teams"
  ON public.teams FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage teams" ON public.teams;
CREATE POLICY "Admins manage teams"
  ON public.teams FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

DROP POLICY IF EXISTS "Everyone can view team memberships" ON public.team_members;
CREATE POLICY "Everyone can view team memberships"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage team memberships" ON public.team_members;
CREATE POLICY "Admins manage team memberships"
  ON public.team_members FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

COMMIT;
