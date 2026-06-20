-- Private personal tasks: a simple per-user checklist (e.g. "pick up kid from school")
-- that is NOT visible to anyone else, including admins.
--
-- Deliberately a separate table from `tasks`: every existing policy on `tasks`
-- includes an `is_admin_user()` OR-clause (see 005_setup_domain_auth_v2.sql),
-- so a flag on `tasks` could never be made truly private to just the owner.
-- This table has exactly one policy, with no admin clause at all.

CREATE TABLE IF NOT EXISTS public.personal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMP WITH TIME ZONE,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_id ON public.personal_tasks(user_id);

ALTER TABLE public.personal_tasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_tasks TO authenticated;

DROP POLICY IF EXISTS "Users manage only their own personal tasks" ON public.personal_tasks;
CREATE POLICY "Users manage only their own personal tasks"
  ON public.personal_tasks FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
