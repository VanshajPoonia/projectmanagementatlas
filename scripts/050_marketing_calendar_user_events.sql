-- Allow Kayla (or any assigned user) to create and delete their own marketing calendar events,
-- so they can add recurring posts directly from the UI instead of only via admin SQL imports.
-- Source columns are made nullable; user-created rows leave them NULL so the import unique
-- index (source_sheet, source_row, source_column) does not interfere (NULLs are not equal
-- in PostgreSQL unique indexes, so multiple NULL rows are allowed).

BEGIN;

ALTER TABLE public.marketing_calendar_items
  ALTER COLUMN source_sheet   DROP NOT NULL,
  ALTER COLUMN source_row     DROP NOT NULL,
  ALTER COLUMN source_column  DROP NOT NULL;

-- Let assigned users insert events for themselves
DROP POLICY IF EXISTS "Users can create own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Users can create own marketing calendar items"
  ON public.marketing_calendar_items FOR INSERT
  TO authenticated
  WITH CHECK (assigned_to = auth.uid());

-- Let assigned users update events they created (source_sheet IS NULL = user-created)
DROP POLICY IF EXISTS "Users can update own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Users can update own marketing calendar items"
  ON public.marketing_calendar_items FOR UPDATE
  TO authenticated
  USING  (assigned_to = auth.uid() AND source_sheet IS NULL)
  WITH CHECK (assigned_to = auth.uid());

-- Let assigned users delete only user-created events (not the imported ones)
DROP POLICY IF EXISTS "Users can delete own marketing calendar items" ON public.marketing_calendar_items;
CREATE POLICY "Users can delete own marketing calendar items"
  ON public.marketing_calendar_items FOR DELETE
  TO authenticated
  USING (assigned_to = auth.uid() AND source_sheet IS NULL);

COMMIT;
