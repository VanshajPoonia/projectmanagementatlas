-- Add a super_admin role. Super Admin = everything Admin can do, plus user management
-- (add/delete users, change roles). Regular Admin keeps board/task management but loses
-- access to user management (gated in app/api/admin/* routes, not RLS).
BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'super_admin'::text]));

-- Single chokepoint already used by task RLS (can_view_task/can_manage_task/can_delete_task).
-- Widening this one function to include super_admin is enough to give super admins full
-- admin-level task access without touching the task policies themselves.
CREATE OR REPLACE FUNCTION private.is_admin_user()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
$function$;

-- Promote every current admin to super_admin, per the chosen migration path.
UPDATE public.profiles SET role = 'super_admin' WHERE role = 'admin';

-- Re-point every other "role = 'admin'" RLS policy at the same chokepoint so promoted
-- super_admins keep their admin-level access to boards/columns/tags/etc.
ALTER POLICY "Only admins can create boards" ON public.boards
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Only admins can delete boards" ON public.boards
  USING (private.is_admin_user());
ALTER POLICY "Only admins can update boards" ON public.boards
  USING (private.is_admin_user());
ALTER POLICY "View active boards, admins see archived too" ON public.boards
  USING ((archived_at IS NULL) OR private.is_admin_user());

ALTER POLICY "Admins can create company bookmarks" ON public.bookmarks
  WITH CHECK ((scope = 'company'::text) AND (created_by = auth.uid()) AND private.is_admin_user());
ALTER POLICY "Admins can delete company bookmarks" ON public.bookmarks
  USING ((scope = 'company'::text) AND private.is_admin_user());
ALTER POLICY "Admins can update company bookmarks" ON public.bookmarks
  USING ((scope = 'company'::text) AND private.is_admin_user())
  WITH CHECK ((scope = 'company'::text) AND private.is_admin_user());

ALTER POLICY "Admin can manage all messages" ON public.chat_messages
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Users can view chat messages" ON public.chat_messages
  USING ((sender_id = auth.uid()) OR (recipient_id = auth.uid()) OR private.is_admin_user());

ALTER POLICY "Only admins can create columns" ON public.columns
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Only admins can delete columns" ON public.columns
  USING (private.is_admin_user());
ALTER POLICY "Only admins can update columns" ON public.columns
  USING (private.is_admin_user());

ALTER POLICY "Admins manage marketing calendar checks" ON public.marketing_calendar_checks
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Users view own marketing calendar checks" ON public.marketing_calendar_checks
  USING ((user_id = auth.uid()) OR private.is_admin_user());

ALTER POLICY "Admins manage marketing calendar items" ON public.marketing_calendar_items
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Users view assigned marketing calendar items" ON public.marketing_calendar_items
  USING ((assigned_to = auth.uid()) OR private.is_admin_user());

ALTER POLICY "Only admins can create tags" ON public.tags
  WITH CHECK (private.is_admin_user());
ALTER POLICY "Only admins can delete tags" ON public.tags
  USING (private.is_admin_user());
ALTER POLICY "Only admins can update tags" ON public.tags
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

ALTER POLICY "Admins can manage statuses" ON public.task_statuses
  USING (private.is_admin_user())
  WITH CHECK (private.is_admin_user());

COMMIT;
