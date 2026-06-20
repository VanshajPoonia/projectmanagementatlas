-- Collaborative task visibility and assignment controls.
--
-- Run after 034. This makes task visibility explicit:
--   assigned - admin, creator, and assignees can see/manage the task
--   board    - everyone can see the task, admin/creator/assignees can manage it
--
-- It also adds task links, in-app assignment notifications, and soft-delete fields
-- so task deletion can be undone from the UI.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_visibility_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_visibility_check CHECK (visibility IN ('assigned', 'board'));

CREATE INDEX IF NOT EXISTS idx_tasks_visibility ON public.tasks(visibility);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON public.tasks(deleted_at);

ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS file_data TEXT;

ALTER TABLE public.task_attachments
  ALTER COLUMN file_url DROP NOT NULL;

ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

UPDATE public.task_comments
SET author_id = COALESCE(author_id, user_id)
WHERE author_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_comments_author_id ON public.task_comments(author_id);

CREATE TABLE IF NOT EXISTS public.task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON public.task_links(task_id);

CREATE TABLE IF NOT EXISTS public.task_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'assignment',
  message TEXT NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_recipient
  ON public.task_notifications(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_notifications_task_id ON public.task_notifications(task_id);

CREATE OR REPLACE FUNCTION private.is_admin_user()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.can_view_task(
  p_task_id UUID,
  p_created_by UUID,
  p_visibility TEXT,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      private.is_admin_user()
      OR p_visibility = 'board'
      OR p_created_by = auth.uid()
      OR p_assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.task_assignees ta
        WHERE ta.task_id = p_task_id
          AND ta.user_id = auth.uid()
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_task(
  p_task_id UUID,
  p_created_by UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      private.is_admin_user()
      OR p_created_by = auth.uid()
      OR p_assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.task_assignees ta
        WHERE ta.task_id = p_task_id
          AND ta.user_id = auth.uid()
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.can_delete_task(
  p_created_by UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (
      private.is_admin_user()
      OR p_created_by = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION private.enforce_task_soft_delete_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND (
      NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
    )
    AND NOT private.can_delete_task(OLD.created_by)
  THEN
    RAISE EXCEPTION 'Only task creators and admins can delete or restore tasks'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_task(UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_task(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_delete_task(UUID) TO authenticated;

DROP TRIGGER IF EXISTS enforce_task_soft_delete_permission ON public.tasks;
CREATE TRIGGER enforce_task_soft_delete_permission
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_task_soft_delete_permission();

ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_assignees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_notifications TO authenticated;

DROP POLICY IF EXISTS "Users can view all tasks" ON public.tasks;
DROP POLICY IF EXISTS "Only admins can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins and assigned users can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Only admins can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can manage all tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can view assigned tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update assigned tasks" ON public.tasks;
DROP POLICY IF EXISTS "Collaborators can view visible tasks" ON public.tasks;
DROP POLICY IF EXISTS "Collaborators can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Collaborators can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Creators and admins can delete tasks" ON public.tasks;

CREATE POLICY "Collaborators can view visible tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (private.can_view_task(id, created_by, visibility, assigned_to));

CREATE POLICY "Collaborators can create tasks"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

CREATE POLICY "Collaborators can update tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (private.can_manage_task(id, created_by, assigned_to))
  WITH CHECK (private.can_manage_task(id, created_by, assigned_to));

CREATE POLICY "Creators and admins can delete tasks"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (private.can_delete_task(created_by));

DROP POLICY IF EXISTS "Users can view task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Admins can manage task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Collaborators can view task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Collaborators can manage task assignees" ON public.task_assignees;

CREATE POLICY "Collaborators can view task assignees"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can manage task assignees"
  ON public.task_assignees FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can view attachments for tasks they can see" ON public.task_attachments;
DROP POLICY IF EXISTS "Users can upload attachments to tasks" ON public.task_attachments;
DROP POLICY IF EXISTS "Users can delete their own attachments" ON public.task_attachments;
DROP POLICY IF EXISTS "Collaborators can view task attachments" ON public.task_attachments;
DROP POLICY IF EXISTS "Collaborators can upload task attachments" ON public.task_attachments;
DROP POLICY IF EXISTS "Collaborators can delete task attachments" ON public.task_attachments;

CREATE POLICY "Collaborators can view task attachments"
  ON public.task_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can upload task attachments"
  ON public.task_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can delete task attachments"
  ON public.task_attachments FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_delete_task(t.created_by)
    )
  );

DROP POLICY IF EXISTS "Users can view comments on tasks they can see" ON public.task_comments;
DROP POLICY IF EXISTS "Authenticated users can create comments" ON public.task_comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON public.task_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.task_comments;
DROP POLICY IF EXISTS "Collaborators can view task comments" ON public.task_comments;
DROP POLICY IF EXISTS "Collaborators can create task comments" ON public.task_comments;
DROP POLICY IF EXISTS "Users can update own task comments" ON public.task_comments;
DROP POLICY IF EXISTS "Users can delete own task comments" ON public.task_comments;

CREATE POLICY "Collaborators can view task comments"
  ON public.task_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can create task comments"
  ON public.task_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Users can update own task comments"
  ON public.task_comments FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own task comments"
  ON public.task_comments FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

DROP POLICY IF EXISTS "Users can view all task_tags" ON public.task_tags;
DROP POLICY IF EXISTS "Only admins can create task_tags" ON public.task_tags;
DROP POLICY IF EXISTS "Only admins can delete task_tags" ON public.task_tags;
DROP POLICY IF EXISTS "Collaborators can view task tags" ON public.task_tags;
DROP POLICY IF EXISTS "Collaborators can manage task tags" ON public.task_tags;

CREATE POLICY "Collaborators can view task tags"
  ON public.task_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can manage task tags"
  ON public.task_tags FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can view task links" ON public.task_links;
DROP POLICY IF EXISTS "Collaborators can manage task links" ON public.task_links;
DROP POLICY IF EXISTS "Collaborators can create task links" ON public.task_links;
DROP POLICY IF EXISTS "Collaborators can update task links" ON public.task_links;
DROP POLICY IF EXISTS "Collaborators can delete task links" ON public.task_links;

CREATE POLICY "Collaborators can view task links"
  ON public.task_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can create task links"
  ON public.task_links FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can update task links"
  ON public.task_links FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

CREATE POLICY "Collaborators can delete task links"
  ON public.task_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Users can view own task notifications" ON public.task_notifications;
DROP POLICY IF EXISTS "Users can update own task notifications" ON public.task_notifications;
DROP POLICY IF EXISTS "Collaborators can create task notifications" ON public.task_notifications;

CREATE POLICY "Users can view own task notifications"
  ON public.task_notifications FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

CREATE POLICY "Users can update own task notifications"
  ON public.task_notifications FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "Collaborators can create task notifications"
  ON public.task_notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

COMMIT;
