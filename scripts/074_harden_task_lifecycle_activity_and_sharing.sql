-- Finish the task-lifecycle work started in 063/069/072:
--   * a top-level task's managed status and column can no longer disagree
--   * every board has a status-linked Cancelled column
--   * cancellation archives automatically, and only super admins can restore
--   * archived tasks and their child records are hidden from everyone else
--   * task status history is recorded transactionally in structured activity fields
--   * authenticated clients cannot hard-delete tasks/boards
--   * share links can only be created for resources the actor is allowed to share

BEGIN;

-- ---------------------------------------------------------------------------
-- Structured, canonical task activity
-- ---------------------------------------------------------------------------

ALTER TABLE public.task_activity
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS from_value JSONB,
  ADD COLUMN IF NOT EXISTS to_value JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_task_activity_event_type_created_at
  ON public.task_activity(event_type, created_at);

-- Normal clients may continue writing human-readable, non-authoritative activity.
-- Structured status fields are intentionally omitted from their column grant: the
-- lifecycle trigger below is the sole writer of metrics-grade status history.
REVOKE INSERT ON public.task_activity FROM authenticated;
GRANT INSERT (task_id, actor_id, action) ON public.task_activity TO authenticated;

-- ---------------------------------------------------------------------------
-- Status-linked board columns and one-time reconciliation
-- ---------------------------------------------------------------------------

-- Link exact status-label columns created since migration 063, without stealing a
-- key already linked to another column on the same board.
UPDATE public.columns c
SET status_key = s.key
FROM public.task_statuses s
WHERE c.status_key IS NULL
  AND lower(btrim(c.title)) = lower(btrim(s.label))
  AND NOT EXISTS (
    SELECT 1
    FROM public.columns sibling
    WHERE sibling.board_id = c.board_id
      AND sibling.id <> c.id
      AND sibling.status_key = s.key
  );

-- Cancelled is a lifecycle state, not an optional custom column. Add it to every
-- board that does not already have one.
INSERT INTO public.columns (board_id, title, position, status_key)
SELECT
  b.id,
  s.label,
  COALESCE((
    SELECT max(existing.position) + 1
    FROM public.columns existing
    WHERE existing.board_id = b.id
  ), 0),
  s.key
FROM public.boards b
JOIN public.task_statuses s ON s.key = 'cancelled'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.columns existing
  WHERE existing.board_id = b.id
    AND existing.status_key = 'cancelled'
);

-- A board has exactly one destination for a managed status. This makes status
-- changes deterministic in the UI and in the trigger below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_columns_board_status_key_unique
  ON public.columns(board_id, status_key)
  WHERE status_key IS NOT NULL;

-- Preserve the user's explicit status intent when repairing legacy mismatches:
-- if the board has a column for the stored status, move the card there. Common
-- historical aliases are normalized first.
UPDATE public.tasks t
SET column_id = (
  SELECT destination.id
  FROM public.columns destination
  WHERE destination.board_id = current_column.board_id
    AND destination.status_key = CASE
      WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('todo', 'to-do') THEN 'to_do'
      WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('complete', 'completed') THEN 'done'
      WHEN lower(replace(btrim(t.status), ' ', '_')) = 'canceled' THEN 'cancelled'
      ELSE lower(replace(btrim(t.status), ' ', '_'))
    END
  LIMIT 1
)
FROM public.columns current_column
WHERE t.column_id = current_column.id
  AND t.parent_task_id IS NULL
  AND current_column.status_key IS NOT NULL
  AND current_column.status_key IS DISTINCT FROM CASE
    WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('todo', 'to-do') THEN 'to_do'
    WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('complete', 'completed') THEN 'done'
    WHEN lower(replace(btrim(t.status), ' ', '_')) = 'canceled' THEN 'cancelled'
    ELSE lower(replace(btrim(t.status), ' ', '_'))
  END
  AND EXISTS (
    SELECT 1
    FROM public.columns destination
    WHERE destination.board_id = current_column.board_id
      AND destination.status_key = CASE
        WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('todo', 'to-do') THEN 'to_do'
        WHEN lower(replace(btrim(t.status), ' ', '_')) IN ('complete', 'completed') THEN 'done'
        WHEN lower(replace(btrim(t.status), ' ', '_')) = 'canceled' THEN 'cancelled'
        ELSE lower(replace(btrim(t.status), ' ', '_'))
      END
  );

-- If a legacy raw status has no valid destination, the linked column remains the
-- source of truth. Subtasks are excluded because checklist completion is allowed
-- to differ from the parent task's board column.
UPDATE public.tasks t
SET status = c.status_key
FROM public.columns c
WHERE t.column_id = c.id
  AND t.parent_task_id IS NULL
  AND c.status_key IS NOT NULL
  AND t.status IS DISTINCT FROM c.status_key;

-- Existing rows reconciled into Cancelled by the update above ran through 069's
-- archive trigger. This also covers any already-cancelled row that predated it.
UPDATE public.tasks t
SET archived_at = COALESCE(t.archived_at, now()),
    archived_by = COALESCE(t.archived_by, t.created_by)
FROM public.columns c
WHERE t.column_id = c.id
  AND t.parent_task_id IS NULL
  AND c.status_key = 'cancelled'
  AND t.archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Enforce lifecycle integrity for every write path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.normalized_task_status_key(raw_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN raw_status IS NULL OR btrim(raw_status) = '' THEN NULL
    WHEN lower(replace(btrim(raw_status), ' ', '_')) IN ('todo', 'to-do') THEN 'to_do'
    WHEN lower(replace(btrim(raw_status), ' ', '_')) IN ('complete', 'completed') THEN 'done'
    WHEN lower(replace(btrim(raw_status), ' ', '_')) = 'canceled' THEN 'cancelled'
    ELSE lower(replace(btrim(raw_status), ' ', '_'))
  END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_task_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_column_status TEXT;
  new_column_status TEXT;
  requested_status TEXT;
  destination_column_id UUID;
BEGIN
  SELECT status_key
  INTO new_column_status
  FROM public.columns
  WHERE id = NEW.column_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task column does not exist'
      USING ERRCODE = '23503';
  END IF;

  requested_status := private.normalized_task_status_key(NEW.status);

  -- Subtasks are checklist rows: their done/open state deliberately does not move
  -- them away from their parent task's board column.
  IF NEW.parent_task_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF new_column_status IS NOT NULL
         AND requested_status IS NOT NULL
         AND requested_status IS DISTINCT FROM new_column_status THEN
        SELECT destination.id
        INTO destination_column_id
        FROM public.columns destination
        JOIN public.columns origin ON origin.board_id = destination.board_id
        WHERE origin.id = NEW.column_id
          AND destination.status_key = requested_status
        LIMIT 1;

        IF destination_column_id IS NULL THEN
          RAISE EXCEPTION 'No column on this board is linked to status "%"', requested_status
            USING ERRCODE = '23514';
        END IF;

        NEW.column_id := destination_column_id;
        new_column_status := requested_status;
        NEW.status := requested_status;
      ELSIF new_column_status IS NOT NULL THEN
        NEW.status := new_column_status;
      END IF;
    ELSE
      SELECT status_key
      INTO old_column_status
      FROM public.columns
      WHERE id = OLD.column_id;

      IF NEW.status IS DISTINCT FROM OLD.status
         AND NEW.column_id IS NOT DISTINCT FROM OLD.column_id THEN
        SELECT destination.id
        INTO destination_column_id
        FROM public.columns destination
        JOIN public.columns origin ON origin.board_id = destination.board_id
        WHERE origin.id = NEW.column_id
          AND destination.status_key = requested_status
        LIMIT 1;

        IF destination_column_id IS NULL THEN
          RAISE EXCEPTION 'No column on this board is linked to status "%"', requested_status
            USING ERRCODE = '23514';
        END IF;

        NEW.column_id := destination_column_id;
        new_column_status := requested_status;
        NEW.status := requested_status;
      ELSIF NEW.column_id IS DISTINCT FROM OLD.column_id
            AND new_column_status IS NOT NULL THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           AND requested_status IS DISTINCT FROM new_column_status THEN
          RAISE EXCEPTION 'Task status "%" does not match destination column status "%"',
            requested_status, new_column_status
            USING ERRCODE = '23514';
        END IF;
        NEW.status := new_column_status;
      ELSIF new_column_status IS NOT NULL
            AND requested_status IS DISTINCT FROM new_column_status THEN
        -- Heal a stale row during any subsequent edit instead of preserving drift.
        NEW.status := new_column_status;
      END IF;
    END IF;

    -- Cancellation is the archive action. Restoring means moving the task out of
    -- Cancelled, and that transition is super-admin-only.
    IF new_column_status = 'cancelled' THEN
      IF TG_OP = 'UPDATE'
         AND OLD.archived_at IS NOT NULL
         AND NEW.archived_at IS NULL
         AND NEW.column_id IS NOT DISTINCT FROM OLD.column_id THEN
        RAISE EXCEPTION 'Move the task out of Cancelled to restore it'
          USING ERRCODE = '23514';
      END IF;

      NEW.archived_at := COALESCE(NEW.archived_at, now());
      NEW.archived_by := COALESCE(NEW.archived_by, auth.uid(), NEW.created_by);
    ELSIF TG_OP = 'UPDATE'
          AND (old_column_status = 'cancelled' OR OLD.archived_at IS NOT NULL) THEN
      IF NOT private.is_super_admin_user() THEN
        RAISE EXCEPTION 'Only a super admin can restore an archived task'
          USING ERRCODE = '42501';
      END IF;
      NEW.archived_at := NULL;
      NEW.archived_by := NULL;
    ELSIF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Move the task to Cancelled to archive it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_task_cancel_archive ON public.tasks;
DROP TRIGGER IF EXISTS enforce_task_lifecycle ON public.tasks;
CREATE TRIGGER enforce_task_lifecycle
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_task_lifecycle();

-- Record canonical status history after the lifecycle trigger has resolved the
-- final column/status. This runs in the same transaction as the task mutation, so
-- drag-and-drop, calendar toggles, modal edits and API writes cannot skip metrics.
CREATE OR REPLACE FUNCTION private.log_task_status_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_key TEXT;
  new_key TEXT;
  old_label TEXT;
  new_label TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_task_id IS NULL THEN
      SELECT COALESCE(c.status_key, private.normalized_task_status_key(NEW.status))
      INTO new_key
      FROM public.columns c
      WHERE c.id = NEW.column_id;
    ELSE
      new_key := private.normalized_task_status_key(NEW.status);
    END IF;

    SELECT COALESCE(s.label, initcap(replace(new_key, '_', ' ')))
    INTO new_label
    FROM (SELECT 1) seed
    LEFT JOIN public.task_statuses s ON s.key = new_key;

    INSERT INTO public.task_activity (
      task_id, actor_id, action, event_type, from_value, to_value, metadata
    )
    VALUES (
      NEW.id,
      auth.uid(),
      format('created the task in "%s"', COALESCE(new_label, new_key, 'Unknown')),
      'task.status_initialized',
      to_jsonb('Created'::text),
      to_jsonb(COALESCE(new_label, new_key, 'Unknown')),
      jsonb_build_object('from_key', NULL, 'to_key', new_key, 'source', 'database_trigger')
    );

    RETURN NEW;
  END IF;

  IF NEW.parent_task_id IS NULL THEN
    SELECT COALESCE(c.status_key, private.normalized_task_status_key(OLD.status))
    INTO old_key
    FROM public.columns c
    WHERE c.id = OLD.column_id;

    SELECT COALESCE(c.status_key, private.normalized_task_status_key(NEW.status))
    INTO new_key
    FROM public.columns c
    WHERE c.id = NEW.column_id;
  ELSE
    old_key := private.normalized_task_status_key(OLD.status);
    new_key := private.normalized_task_status_key(NEW.status);
  END IF;

  IF old_key IS NOT DISTINCT FROM new_key THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.label, initcap(replace(old_key, '_', ' ')))
  INTO old_label
  FROM (SELECT 1) seed
  LEFT JOIN public.task_statuses s ON s.key = old_key;

  SELECT COALESCE(s.label, initcap(replace(new_key, '_', ' ')))
  INTO new_label
  FROM (SELECT 1) seed
  LEFT JOIN public.task_statuses s ON s.key = new_key;

  INSERT INTO public.task_activity (
    task_id, actor_id, action, event_type, from_value, to_value, metadata
  )
  VALUES (
    NEW.id,
    auth.uid(),
    format(
      'changed status from "%s" to "%s"',
      COALESCE(old_label, old_key, 'Unknown'),
      COALESCE(new_label, new_key, 'Unknown')
    ),
    'task.status_changed',
    to_jsonb(COALESCE(old_label, old_key, 'Unknown')),
    to_jsonb(COALESCE(new_label, new_key, 'Unknown')),
    jsonb_build_object('from_key', old_key, 'to_key', new_key, 'source', 'database_trigger')
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS log_task_status_activity ON public.tasks;
CREATE TRIGGER log_task_status_activity
  AFTER INSERT OR UPDATE OF column_id, status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.log_task_status_activity();

-- ---------------------------------------------------------------------------
-- Archive visibility and hard-delete prevention
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.can_view_task(
  p_task_id UUID,
  p_created_by UUID,
  p_visibility TEXT,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      private.is_super_admin_user()
      OR NOT EXISTS (
        SELECT 1
        FROM public.tasks archived_task
        WHERE archived_task.id = p_task_id
          AND archived_task.archived_at IS NOT NULL
      )
    )
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
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
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_task(
  p_task_id UUID,
  p_created_by UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      private.is_super_admin_user()
      OR NOT EXISTS (
        SELECT 1
        FROM public.tasks archived_task
        WHERE archived_task.id = p_task_id
          AND archived_task.archived_at IS NOT NULL
      )
    )
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
    AND NOT private.task_restricted_by_board_role(p_task_id)
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
$function$;

DROP POLICY IF EXISTS "Creators and admins can delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Only admins can delete boards" ON public.boards;
REVOKE DELETE, TRUNCATE ON public.tasks, public.boards FROM authenticated;

CREATE OR REPLACE FUNCTION private.prevent_authenticated_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This record must be archived, not deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_task_hard_delete ON public.tasks;
CREATE TRIGGER prevent_task_hard_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_authenticated_hard_delete();

DROP TRIGGER IF EXISTS prevent_board_hard_delete ON public.boards;
CREATE TRIGGER prevent_board_hard_delete
  BEFORE DELETE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_authenticated_hard_delete();

-- Deleting a non-empty column would cascade through tasks and bypass their direct
-- DELETE privilege. Empty custom columns may still be removed.
CREATE OR REPLACE FUNCTION private.prevent_nonempty_column_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.column_id = OLD.id) THEN
    RAISE EXCEPTION 'Move or archive every task before deleting this column'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_nonempty_column_delete ON public.columns;
CREATE TRIGGER prevent_nonempty_column_delete
  BEFORE DELETE ON public.columns
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_nonempty_column_delete();

-- ---------------------------------------------------------------------------
-- Share-link authorization and least-privilege mutation
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Manage own share links" ON public.share_links;
DROP POLICY IF EXISTS "View manageable share links" ON public.share_links;
DROP POLICY IF EXISTS "Create authorized share links" ON public.share_links;
DROP POLICY IF EXISTS "Revoke manageable share links" ON public.share_links;

REVOKE ALL ON public.share_links FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.share_links FROM authenticated;
GRANT SELECT, INSERT ON public.share_links TO authenticated;
GRANT UPDATE (revoked_at) ON public.share_links TO authenticated;

CREATE POLICY "View manageable share links"
  ON public.share_links FOR SELECT
  TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR private.is_admin_user()
  );

CREATE POLICY "Create authorized share links"
  ON public.share_links FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      (
        resource_type = 'board'
        AND EXISTS (
          SELECT 1
          FROM public.boards b
          WHERE b.id = resource_id
            AND b.archived_at IS NULL
            AND (
              b.created_by = (SELECT auth.uid())
              OR private.is_admin_user()
            )
            AND (
              NOT b.is_private
              OR b.created_by = (SELECT auth.uid())
              OR public.is_board_member(b.id, (SELECT auth.uid()))
            )
        )
      )
      OR
      (
        resource_type = 'task'
        AND EXISTS (
          SELECT 1
          FROM public.tasks t
          JOIN public.columns c ON c.id = t.column_id
          JOIN public.boards b ON b.id = c.board_id
          WHERE t.id = resource_id
            AND t.deleted_at IS NULL
            AND t.archived_at IS NULL
            AND b.archived_at IS NULL
            AND (
              t.created_by = (SELECT auth.uid())
              OR private.is_admin_user()
            )
            AND (
              NOT b.is_private
              OR b.created_by = (SELECT auth.uid())
              OR public.is_board_member(b.id, (SELECT auth.uid()))
            )
        )
      )
    )
  );

CREATE POLICY "Revoke manageable share links"
  ON public.share_links FOR UPDATE
  TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR private.is_admin_user()
  )
  WITH CHECK (
    (
      created_by = (SELECT auth.uid())
      OR private.is_admin_user()
    )
    AND revoked_at IS NOT NULL
  );

COMMIT;
