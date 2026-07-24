-- Module activation (PROMPT 3 slice, "Phase 1-C"). A SINGLETON config table — no org_id column,
-- there is exactly one organization (see CLAUDE.md's single-org ruling, 2026-07-24). Nav and
-- route guards will read this via lib/modules.ts instead of hardcoding which sections exist.
--
-- Seeded with every current module enabled=true, so nothing changes for anyone today — this
-- migration only adds the switch, it does not flip it. Wiring the nav to actually read from it
-- is separate follow-up work (this migration is schema-only).

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_modules (
  module_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_modules TO authenticated;

DROP POLICY IF EXISTS "Everyone can view modules" ON public.app_modules;
CREATE POLICY "Everyone can view modules"
  ON public.app_modules FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage modules" ON public.app_modules;
CREATE POLICY "Admins manage modules"
  ON public.app_modules FOR ALL
  TO authenticated
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

INSERT INTO public.app_modules (module_key, enabled) VALUES
  ('boards', true),
  ('personal_tasks', true),
  ('chat', true),
  ('calendar', true),
  ('bookmarks', true),
  ('marketing_calendar', true),
  ('reports', true),
  ('ai_assistant', true)
ON CONFLICT (module_key) DO NOTHING;

COMMIT;
