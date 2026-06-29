-- profiles RLS only checked auth.uid() = id for UPDATE, with no WITH CHECK restricting
-- which columns a user may change about themselves. Any authenticated user could call
-- supabase.from('profiles').update({ role: 'super_admin' }) directly (via the public anon
-- key) and self-promote, bypassing the admin/super_admin gate entirely.
--
-- Lock role/is_active changes to the service-role connection only, which is what the
-- /api/admin/create-user, update-user, and delete-user routes already use after checking
-- the caller is a super_admin. RLS can't express "only certain columns" cleanly here, so
-- this is enforced at the grant level instead.
-- authenticated/anon hold a table-wide UPDATE grant from the original schema, so a
-- column-level REVOKE alone has no effect (the table-wide grant still covers it). Revoke
-- the table-wide grant and re-grant UPDATE on every column except role/is_active.
BEGIN;
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (
  email, full_name, avatar_url, updated_at,
  notify_email_assignment, notify_email_update, notify_email_comment, notify_email_due_soon
) ON public.profiles TO authenticated, anon;
COMMIT;
