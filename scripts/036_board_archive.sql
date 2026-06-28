-- Board archiving (Vs PM Portal #16): "archive a board, but NEVER delete anything.
-- Just archive it in a place that ONLY the super admin can see it."
--
-- Soft-archive via archived_at/archived_by (same pattern as task soft-delete in 035).
-- Non-admins stop seeing archived boards at the RLS level; admins still see everything.

BEGIN;

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_boards_archived_at ON public.boards(archived_at);

-- Archived boards are visible only to admins. Everyone else sees active boards only.
DROP POLICY IF EXISTS "Users can view all boards" ON public.boards;
DROP POLICY IF EXISTS "View active boards, admins see archived too" ON public.boards;
CREATE POLICY "View active boards, admins see archived too"
  ON public.boards FOR SELECT
  TO authenticated
  USING (
    archived_at IS NULL
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

COMMIT;
