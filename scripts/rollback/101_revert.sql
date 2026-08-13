-- Rollback for 101_deactivation_is_real.sql.
--
-- ⚠️ THIS MAKES DEACTIVATION INERT AGAIN. Every account currently switched off regains full
-- access the moment this runs, silently, while the Super Admin screen keeps showing them as
-- Inactive. Check who is affected FIRST:
--
--   SELECT email, role, deactivated_at FROM public.profiles WHERE is_active IS FALSE;
--
-- If that returns anyone, reactivate them deliberately (or delete them) before reverting,
-- rather than handing access back by accident. The GoTrue bans are NOT undone by this file —
-- they live in the auth server, so a reverted database plus a standing ban leaves someone
-- unable to sign in with no flag explaining why. Lift those with
-- `auth.admin.updateUserById(id, { ban_duration: 'none' })`.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_admin_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'));
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION private.can_manage_task(p_task_id UUID, p_created_by UUID, p_assigned_to UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
    AND NOT private.task_restricted_by_board_role(p_task_id)
    AND (
      private.is_admin_user()
      OR p_created_by = auth.uid()
      OR p_assigned_to = auth.uid()
      OR EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = p_task_id AND ta.user_id = auth.uid())
    );
$$;

DROP POLICY IF EXISTS "Collaborators can create tasks" ON public.tasks;
CREATE POLICY "Collaborators can create tasks" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND NOT private.column_hidden_by_board_privacy(column_id)
    AND NOT private.column_restricted_by_board_role(column_id)
  );

DROP POLICY IF EXISTS "Collaborators can create task comments" ON public.task_comments;
CREATE POLICY "Collaborators can create task comments" ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_comments.task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can send chat messages" ON public.chat_messages;
CREATE POLICY "Users can send chat messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND recipient_id <> auth.uid()
    AND recipient_id IN (SELECT profiles.id FROM public.profiles)
  );

-- Restores the wide table-level grant this migration narrowed.
GRANT UPDATE ON public.profiles TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_profile_active ON public.profiles;
DROP FUNCTION IF EXISTS private.audit_profile_active();
DROP FUNCTION IF EXISTS private.is_active_user();

-- deactivated_at / deactivated_by are left in place: they are additive, harmless, and hold a
-- record of who was switched off and when, which is worth keeping even if the enforcement goes.

DELETE FROM public.applied_migrations WHERE filename LIKE '101%';

COMMIT;
