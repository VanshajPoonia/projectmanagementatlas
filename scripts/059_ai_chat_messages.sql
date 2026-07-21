-- Private per-user AI chat history for the built-in assistant widget.
-- Same privacy shape as personal_tasks (030): single owner-only policy,
-- no admin OR-clause, so nobody else (including admins) can read a user's
-- chat with the assistant.

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user_id ON public.ai_chat_messages(user_id, created_at);

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.ai_chat_messages TO authenticated;

DROP POLICY IF EXISTS "Users manage only their own AI chat messages" ON public.ai_chat_messages;
CREATE POLICY "Users manage only their own AI chat messages"
  ON public.ai_chat_messages FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
