-- Companies (business units) as a real entity instead of a hardcoded
-- SRG/AGC/BOTH enum scattered across marketing_channels and
-- marketing_calendar_items. Super admins manage this list from the new
-- Super Admin page; everyone else just reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,        -- short code, e.g. 'SRG' — used as a stable reference in UI state
  name TEXT NOT NULL,        -- full name, e.g. 'Shanks Realty Group'
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code ON public.companies (lower(code));

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;

-- Everyone signed in can read the company list (needed to render the marketing calendar).
DROP POLICY IF EXISTS "Anyone can view companies" ON public.companies;
CREATE POLICY "Anyone can view companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins manage entities — a stricter gate than regular admin,
-- matching how user management is already super-admin-only.
DROP POLICY IF EXISTS "Super admins manage companies" ON public.companies;
CREATE POLICY "Super admins manage companies"
  ON public.companies FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Seed the two known business units (see marketing_calendar_items history).
INSERT INTO public.companies (code, name, color, position) VALUES
  ('SRG', 'Shanks Realty Group', '#e91e8c', 0),
  ('AGC', 'Atlas General Contracting', '#7c3aed', 1)
ON CONFLICT (lower(code)) DO NOTHING;

COMMIT;
