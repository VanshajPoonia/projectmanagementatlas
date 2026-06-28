-- Admin-managed statuses (Vs PM Portal #20): "Admin interface has the ability to create
-- or archive any statuses... if a project is in a status that I archive then that project
-- still needs to be searchable later."
--
-- task_statuses is the managed source of truth for the Status dropdowns. tasks.status keeps
-- storing the status *key* (so the existing normalizer and all queries keep working), but the
-- list of available keys is now admin-managed instead of hardcoded. Archiving a status only
-- hides it from the "new status" pickers — existing tasks keep their status and stay
-- searchable (the reports filter lists archived statuses too).

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  position INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.task_statuses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_statuses TO authenticated;

DROP POLICY IF EXISTS "Everyone can view statuses" ON public.task_statuses;
CREATE POLICY "Everyone can view statuses"
  ON public.task_statuses FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage statuses" ON public.task_statuses;
CREATE POLICY "Admins can manage statuses"
  ON public.task_statuses FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Collapse the legacy 'todo' value into the canonical 'to_do' so we don't seed a near-duplicate.
UPDATE public.tasks SET status = 'to_do' WHERE status = 'todo';

-- Canonical defaults.
INSERT INTO public.task_statuses (key, label, color, position) VALUES
  ('to_do', 'To Do', '#64748b', 0),
  ('in_progress', 'In Progress', '#ca8a04', 1),
  ('done', 'Done', '#16a34a', 2)
ON CONFLICT (key) DO NOTHING;

-- Backfill any other status value that already exists on a task, so every task maps to a
-- real status row and remains filterable/searchable.
INSERT INTO public.task_statuses (key, label, position)
SELECT DISTINCT t.status, initcap(replace(t.status, '_', ' ')), 10
FROM public.tasks t
WHERE t.status IS NOT NULL AND t.status <> ''
ON CONFLICT (key) DO NOTHING;

COMMIT;
