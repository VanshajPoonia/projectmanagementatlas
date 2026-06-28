-- Chat unread tracking (Vs PM Portal #25): "Chat needs an indicator on the chat bar
-- and who it was from."
--
-- Adds read_at to chat_messages and lets a recipient mark their own received messages
-- as read. (After 034 there was no UPDATE policy for regular users, only the admin ALL
-- policy, so recipients could not flag messages read.)

BEGIN;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON public.chat_messages(recipient_id, read_at);

DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.chat_messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.chat_messages FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

COMMIT;
