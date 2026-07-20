-- The "New channel" button in the marketing calendar is reachable by any
-- authenticated user who can see that tab (admins + the assigned marketing
-- user, e.g. Kayla) — not just admins. The original admin-only write policy
-- meant a non-admin marketing user clicking "New channel" would silently hit
-- a permission error. Allow any authenticated user to add channels; keep
-- renaming/archiving (UPDATE/DELETE) admin-only since there's no UI for that
-- yet and it affects a shared list.

BEGIN;

DROP POLICY IF EXISTS "Admins manage marketing channels" ON public.marketing_channels;

DROP POLICY IF EXISTS "Anyone can add marketing channels" ON public.marketing_channels;
CREATE POLICY "Anyone can add marketing channels"
  ON public.marketing_channels FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins update marketing channels" ON public.marketing_channels;
CREATE POLICY "Admins update marketing channels"
  ON public.marketing_channels FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins delete marketing channels" ON public.marketing_channels;
CREATE POLICY "Admins delete marketing channels"
  ON public.marketing_channels FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Board drag-and-drop used to derive a task's status by slugifying the
-- destination column's title (e.g. "Completed" -> 'completed'), which doesn't
-- match the canonical 'done' status key that Reports and other filters key
-- off of. Fold any tasks that already picked up that stray value back onto
-- the canonical key. (The board-view drag handler now resolves the column to
-- its matching status key instead of slugifying the title.)
UPDATE public.tasks SET status = 'done' WHERE status = 'completed';

COMMIT;
