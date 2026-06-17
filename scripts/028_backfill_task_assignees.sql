-- Backfill task_assignees from tasks.assigned_to.
--
-- task_assignees (created in 024) is the source of truth for assignment, but
-- tasks created via the single-assignee dialog since then set tasks.assigned_to
-- without a matching task_assignees row. This copies every assigned_to into
-- task_assignees so nothing appears unassigned after the switch to multi-assignee.
--
-- Idempotent: ON CONFLICT DO NOTHING means it is safe to run more than once.
-- Run this BEFORE deploying the multi-assignee code.

INSERT INTO task_assignees (task_id, user_id)
SELECT id, assigned_to
FROM tasks
WHERE assigned_to IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;
