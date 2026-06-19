-- Quick-link bookmarks for the home dashboard. Two scopes in one table:
--   'company'  - admin-curated, visible to everyone (e.g. a shared Drive folder)
--   'personal' - each user's own, visible only to them
--
-- Admin check mirrors the LIVE policies on boards/columns/tasks (inline
-- EXISTS ... role = 'admin' subquery) rather than is_admin_user() / is_admin,
-- which scripts/005 introduced but which never actually made it into production.

CREATE TABLE IF NOT EXISTS public.bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('company', 'personal')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  CHECK (
    (scope = 'company' AND user_id IS NULL)
    OR (scope = 'personal' AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_scope ON public.bookmarks(scope);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON public.bookmarks(user_id);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookmarks TO authenticated;

DROP POLICY IF EXISTS "View company bookmarks and own personal bookmarks" ON public.bookmarks;
CREATE POLICY "View company bookmarks and own personal bookmarks"
  ON public.bookmarks FOR SELECT
  TO authenticated
  USING (scope = 'company' OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own personal bookmarks" ON public.bookmarks;
CREATE POLICY "Users can create their own personal bookmarks"
  ON public.bookmarks FOR INSERT
  TO authenticated
  WITH CHECK (scope = 'personal' AND user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can create company bookmarks" ON public.bookmarks;
CREATE POLICY "Admins can create company bookmarks"
  ON public.bookmarks FOR INSERT
  TO authenticated
  WITH CHECK (
    scope = 'company'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Users can update their own personal bookmarks" ON public.bookmarks;
CREATE POLICY "Users can update their own personal bookmarks"
  ON public.bookmarks FOR UPDATE
  TO authenticated
  USING (scope = 'personal' AND user_id = auth.uid())
  WITH CHECK (scope = 'personal' AND user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can update company bookmarks" ON public.bookmarks;
CREATE POLICY "Admins can update company bookmarks"
  ON public.bookmarks FOR UPDATE
  TO authenticated
  USING (
    scope = 'company'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    scope = 'company'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Users can delete their own personal bookmarks" ON public.bookmarks;
CREATE POLICY "Users can delete their own personal bookmarks"
  ON public.bookmarks FOR DELETE
  TO authenticated
  USING (scope = 'personal' AND user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can delete company bookmarks" ON public.bookmarks;
CREATE POLICY "Admins can delete company bookmarks"
  ON public.bookmarks FOR DELETE
  TO authenticated
  USING (
    scope = 'company'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
