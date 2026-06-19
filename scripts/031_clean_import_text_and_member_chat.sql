-- Clean the Excel backfill labels from the already-imported Main PM board
-- and allow authenticated members to chat with any other profile.
--
-- Run once after scripts/029_import_main_pm_sheet.sql has already imported
-- the Main PM board. Do not run the wipe/reimport scripts first unless you
-- intentionally want to rebuild all board data from scratch.

BEGIN;

UPDATE public.boards
SET description = NULL
WHERE title = 'Main PM Sheet'
  AND description ILIKE 'Imported from Marketing Project Management.xlsx%';

UPDATE public.tasks t
SET description = NULLIF(substring(t.description FROM 'Notes & Status: (.*)$'), '')
FROM public.columns c
JOIN public.boards b ON b.id = c.board_id
WHERE t.column_id = c.id
  AND b.title = 'Main PM Sheet'
  AND t.description LIKE 'Source: Marketing Project Management.xlsx%';

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.chat_messages TO authenticated;

DROP POLICY IF EXISTS "Users can view chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can send chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Admin can manage all messages" ON public.chat_messages;

CREATE POLICY "Users can view chat messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
  );

CREATE POLICY "Users can send chat messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND recipient_id <> auth.uid()
    AND recipient_id IN (SELECT id FROM public.profiles)
  );

CREATE POLICY "Users can delete own messages"
  ON public.chat_messages FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "Admin can manage all messages"
  ON public.chat_messages FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

COMMIT;

SELECT
  b.title AS board,
  b.description AS board_description,
  COUNT(*) FILTER (WHERE t.description LIKE 'Source: Marketing Project Management.xlsx%') AS source_descriptions_remaining
FROM public.boards b
LEFT JOIN public.columns c ON c.board_id = b.id
LEFT JOIN public.tasks t ON t.column_id = c.id
WHERE b.title = 'Main PM Sheet'
GROUP BY b.title, b.description;
