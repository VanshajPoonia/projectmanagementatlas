-- Add optional privacy to boards so admins can create boards visible only to specific members.
-- Default: NOT is_private — all existing boards stay fully visible.
-- When is_private=true, only admins, the creator, and explicit board_members rows can see the board.

BEGIN;

ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Who can see each board
CREATE TABLE IF NOT EXISTS public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.board_members TO authenticated;

-- Members can see their own memberships; admins and the board creator can see all
CREATE POLICY "View board memberships" ON public.board_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    OR EXISTS (SELECT 1 FROM public.boards WHERE id = board_id AND created_by = auth.uid())
  );

CREATE POLICY "Manage board memberships insert" ON public.board_members FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    OR EXISTS (SELECT 1 FROM public.boards WHERE id = board_id AND created_by = auth.uid())
  );

CREATE POLICY "Manage board memberships delete" ON public.board_members FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    OR EXISTS (SELECT 1 FROM public.boards WHERE id = board_id AND created_by = auth.uid())
  );

-- Replace the flat "all authenticated users see all boards" policy with a visibility-aware one
DROP POLICY IF EXISTS "Users can view all boards" ON public.boards;
CREATE POLICY "Users can view boards" ON public.boards FOR SELECT
  USING (
    NOT is_private
    OR auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    OR EXISTS (SELECT 1 FROM public.board_members WHERE board_id = id AND user_id = auth.uid())
  );

-- Keep admin-only write policies, updating them to include super_admin
DROP POLICY IF EXISTS "Only admins can create boards" ON public.boards;
CREATE POLICY "Only admins can create boards" ON public.boards FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')));

DROP POLICY IF EXISTS "Only admins can update boards" ON public.boards;
CREATE POLICY "Only admins can update boards" ON public.boards FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')));

DROP POLICY IF EXISTS "Only admins can delete boards" ON public.boards;
CREATE POLICY "Only admins can delete boards" ON public.boards FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')));

COMMIT;
