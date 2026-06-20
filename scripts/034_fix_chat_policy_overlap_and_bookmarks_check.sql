-- Two fixes found in review:
--
-- 1. chat_messages had two generations of policies stacked together. The
--    newer "Users can send chat messages" INSERT policy deliberately blocks
--    messaging yourself (recipient_id <> auth.uid()) and requires a real
--    recipient profile, but an older, looser duplicate ("Users can send
--    messages": sender_id = auth.uid() only) was left in place. Postgres
--    ORs permissive policies together, so the loose one silently defeated
--    the strict one's guard - confirmed live, a real user could insert a
--    message to themselves. "Users can view their own messages" and
--    "Users can delete own messages" are redundant strict subsets of their
--    newer siblings (harmless, but dead weight) and are dropped too.
--
-- 2. scripts/032's two-part CHECK constraint on bookmarks (company rows must
--    have NULL user_id, personal rows must have a user_id) never reached
--    production - CREATE TABLE IF NOT EXISTS no-ops once the table already
--    exists, so editing the table-defining portion of an already-applied
--    migration never re-applies. Adding it directly here.

BEGIN;

DROP POLICY IF EXISTS "Users can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can view their own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.chat_messages;

ALTER TABLE public.bookmarks DROP CONSTRAINT IF EXISTS bookmarks_scope_user_consistency;
ALTER TABLE public.bookmarks ADD CONSTRAINT bookmarks_scope_user_consistency CHECK (
  (scope = 'company' AND user_id IS NULL)
  OR (scope = 'personal' AND user_id IS NOT NULL)
);

COMMIT;
