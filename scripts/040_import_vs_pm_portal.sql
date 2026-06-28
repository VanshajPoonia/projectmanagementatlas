-- 040_import_vs_pm_portal.sql
-- Imports Bobby's "Vs PM Portal" backlog (28 items) from
-- "Marketing Project Management.xlsx" into a dedicated board.
--
-- - Creates a board "V's PM Portal" owned by Vanshaj.
-- - Three columns: To Do / In Progress / Done.
-- - Every item is a task assigned to Vanshaj (assigned_to + task_assignees),
--   placed in the column matching its real implementation status.
-- - Re-running is a no-op if the board already exists (prevents duplicates).
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/040_import_vs_pm_portal.sql

BEGIN;

DO $$
DECLARE
  v_vanshaj UUID;
  v_board_id UUID;
  v_col_todo UUID;
  v_col_prog UUID;
  v_col_done UUID;
  v_task_id UUID;
  v_col_id UUID;
  rec RECORD;
BEGIN
  SELECT id INTO v_vanshaj FROM public.profiles WHERE lower(email) = 'vanshaj@goatlasgo.us' LIMIT 1;
  IF v_vanshaj IS NULL THEN
    RAISE EXCEPTION 'Vanshaj profile (vanshaj@goatlasgo.us) not found.';
  END IF;

  SELECT id INTO v_board_id FROM public.boards WHERE title = 'V''s PM Portal' LIMIT 1;
  IF v_board_id IS NOT NULL THEN
    RAISE NOTICE 'Board "V''s PM Portal" already exists (%); skipping import to avoid duplicates.', v_board_id;
    RETURN;
  END IF;

  INSERT INTO public.boards (title, description, created_by, color)
  VALUES ('V''s PM Portal',
          'Dev/feature backlog for the PM app — Bobby''s MACD suggestions.',
          v_vanshaj, '#7c3aed')
  RETURNING id INTO v_board_id;

  INSERT INTO public.columns (board_id, title, position, color)
    VALUES (v_board_id, 'To Do', 0, '#64748b') RETURNING id INTO v_col_todo;
  INSERT INTO public.columns (board_id, title, position, color)
    VALUES (v_board_id, 'In Progress', 1, '#ca8a04') RETURNING id INTO v_col_prog;
  INSERT INTO public.columns (board_id, title, position, color)
    VALUES (v_board_id, 'Done', 2, '#16a34a') RETURNING id INTO v_col_done;

  FOR rec IN
    SELECT * FROM (
      VALUES
      ('Toggle between tile and list view', 'The tiles are cool but it would be preferable that we can toggle between tile vs. list view

— Requested by Bobby (V''s PM Portal #1, added 2026-01-22)', 'done', 'Done', 0),
      ('Fix: newly added users not appearing in the list', 'Users added are not appearing after added.

— Requested by Bobby (V''s PM Portal #2, added 2026-01-22)', 'done', 'Done', 1),
      ('Enable/disable a user without deleting their account', 'Ability to turn a user on or off without deleting their account.

— Requested by Bobby (V''s PM Portal #3, added 2026-01-22)', 'done', 'Done', 2),
      ('Each user has their own username & password', 'Each user to have their own UN & PW.

— Requested by Bobby (V''s PM Portal #4, added 2026-01-22)', 'done', 'Done', 3),
      ('Change priority levels from Low/Med/High to 1–5', 'CHANGE: prioty leves from "Low, Med, High" to 1, 2, 3, 4, 5

— Requested by Bobby (V''s PM Portal #5, added 2026-01-22)', 'done', 'Done', 4),
      ('Attach any file type (and multiple files) to a task, with display', 'Ability to attach any type of file to a project and multiple files.  Video. Docs. Sheets. PDF. Literally anything.
Currently you can select a file but when you upload it doesn''t diplay anywhere.

— Requested by Bobby (V''s PM Portal #6, added 2026-01-22)', 'done', 'Done', 5),
      ('Calendar page showing tasks by day/week/month, color-coded per user', 'Would be nice to have a calendar page that shows tasks for the day, week, month, etc.
Layout would be by user and each user would have it''s own color.

The "overview" page would be a good place to show this.

— Requested by Bobby (V''s PM Portal #7, added 2026-01-22)', 'done', 'Done', 6),
      ('Fix: task comments won''t submit on Enter / arrow click', 'When I create a comment specific to a task it won''t let me "enter" or click on the arrow in order for it to show up. Seems broken or unconnected.

— Requested by Bobby (V''s PM Portal #8, added 2026-01-22)', 'done', 'Done', 7),
      ('Assign more than one user to a task (primary + collaborators)', 'Ability to connect more than one user to a task.  Or, perhaps, to create a "primary" user for a task but then to CTRL+Click to select other users too.

— Requested by Bobby (V''s PM Portal #9, added 2026-01-22)', 'done', 'Done', 8),
      ('Reports screen with multi-select filters (user, tag, dates, status, priority)', 'A report screen of some sort where you can filter tasks by:
1. User
2. Tag
3. Entry Date
4. Due Date
5. Status
6. Priority

With the filter being able to CTRL+Click on multiple filter types.

— Requested by Bobby (V''s PM Portal #10, added 2026-01-22)', 'done', 'Done', 9),
      ('Entry date is non-editable and auto-set when a task is completed', 'Entry date is a NON-editable field and is generated when the task is completed.

— Requested by Bobby (V''s PM Portal #11, added 2026-01-22)', 'done', 'Done', 10),
      ('Countdown on each task showing days remaining until due date', 'Count down clock on each task that shows how many days remaining until due date.

— Requested by Bobby (V''s PM Portal #12, added 2026-01-22)', 'done', 'Done', 11),
      ('Support ongoing/recurring tasks (daily/weekly/monthly), not just due dates', '"Due Date" is for tasks that begin and end.  What about tasks that are "on going" in nature and have daily, weekly, or monthly assignments.

— Requested by Bobby (V''s PM Portal #13, added 2026-01-22)', 'done', 'Done', 12),
      ('Mobile-friendly layout (iPhone)', 'Create layout so that''s its user friendly on a mobile device such as an iPhone.

— Requested by Bobby (V''s PM Portal #14, added 2026-01-22)
[Build note: Responsive styling is in place across dashboards; a full mobile QA pass is still pending. See also #27.]', 'in_progress', 'In Progress', 0),
      ('Due date can only be edited by the task creator', 'The "due date" field cannot be edited by anyone othe than the person who created it.

— Requested by Bobby (V''s PM Portal #15, added 2026-01-22)
[Build note: Enforced at the database level via the enforce_task_due_date_permission trigger (scripts/038).]', 'done', 'Done', 13),
      ('Archive a board (never delete) — visible only to the super admin', 'Ability to "archive" a board, but NEVER delete anything.  Just archive it in a place that ONLY the super admin can see it.

— Requested by Bobby (V''s PM Portal #16, added 2026-01-22)
[Build note: Board archive shipped in scripts/036.]', 'done', 'Done', 14),
      ('Super admin sees/edits all boards; users see only their boards & tasks', 'Super Admin can see and edit ALL boards.  Users can only see and edit their specific boards and/or their tasks in each board.

— Requested by Bobby (V''s PM Portal #17, added 2026-01-22)
[Build note: Task visibility model shipped in scripts/035.]', 'done', 'Done', 15),
      ('Chat improvements (request truncated in source sheet)', 'Not really in to the chat area but if it is to be used then it would be best if the chats can be 

— Requested by Bobby (V''s PM Portal #18, added 2026-01-22)
[Build note: The original request text was cut off in Bobby''s sheet. Chat works and now has unread indicators (#25); confirm the rest of this request with Bobby.]', 'in_progress', 'In Progress', 1),
      ('Require status & priority before a new task can be created', 'When a new Task/Project is created the default status is "To Do"
However, it would be best if the system prevents a new task from being entered until the user entering it specifically checks on the status and priority.  In otherwords, the system requires the user to complete any required fields.

— Requested by Bobby (V''s PM Portal #19, added 2026-01-22)', 'done', 'Done', 16),
      ('Admin can create/archive custom statuses; archived stay searchable', 'Admin interface has the ability to create, or archive any statuses.  For example, I want to add a status called, "Escalate to Mgmt." but then I would have an admin interface that I can MACD any statuses at anytime.  However if a project is in a status that I modify or archive then that project still needs to be searchable later.

— Requested by Bobby (V''s PM Portal #20, added 2026-01-22)
[Build note: task_statuses table + admin Statuses tab (scripts/039). Archived statuses remain selectable in the reports filter.]', 'done', 'Done', 17),
      ('Email notifications (was: activate FormSubmit)', 'Action Required: Activate FormSubmit on https://atlasgeneralproject.vercel.app/

Received an email with the verbiage above.  Not sure what this is or if the functionality is fully built out.

— Requested by Bobby (V''s PM Portal #21, added 2026-01-22)
[Build note: FormSubmit was replaced with a proper Resend email integration (lib/email.ts) sending from dashboard@goatlasgo.us.]', 'done', 'Done', 18),
      ('Add an ''Unassigned'' option to the user filter on the reports page', 'On the advanced filters page, under users, there should be a filter for "unassigned" to anyone.

— Requested by Bobby (V''s PM Portal #22, added 2026-01-26)
[Build note: Not yet built: the reports user-filter currently lists only real users. Small add.]', 'to_do', 'To Do', 0),
      ('Reports viewable as a printable table without downloading first', 'The report themselves need to be able to be in printable table/excel formet without having download first.

— Requested by Bobby (V''s PM Portal #23, added 2026-06-25)
[Build note: Print button on the reports page opens a clean printable table.]', 'done', 'Done', 19),
      ('Drill down from a report into each project/task', 'Whenever a report is created on the report page inside that report, we need to be able to have drill down into each project or task

— Requested by Bobby (V''s PM Portal #24, added 2026-06-25)
[Build note: Report rows link through to the task''s board.]', 'done', 'Done', 20),
      ('Chat unread indicator showing count and who it''s from', 'Chat needs to have an indicator on the chat bar and who it was from.

— Requested by Bobby (V''s PM Portal #25, added 2026-06-25)
[Build note: Unread badge on the Chat tab + per-sender unread counts (scripts/037).]', 'done', 'Done', 21),
      ('Admin can edit their own name and password', 'Admin needs to be able to edit their own password or name

— Requested by Bobby (V''s PM Portal #26, added 2026-06-25)
[Build note: Account Settings dialog in the header.]', 'done', 'Done', 22),
      ('Make the app mobile friendly', 'Make mobile friendly

— Requested by Bobby (V''s PM Portal #27, added 2026-06-25)
[Build note: Same track as #14 — responsive layout in place, full mobile pass pending.]', 'in_progress', 'In Progress', 2),
      ('Users can choose collaborators per board and per task tile', 'User can choose who to collab with on each board and on tiles

— Requested by Bobby (V''s PM Portal #28, added 2026-06-25)
[Build note: Multi-assignee collaboration + per-task visibility shipped in scripts/035.]', 'done', 'Done', 23)
    ) AS s(title, description, status, col_title, position)
  LOOP
    v_col_id := CASE rec.col_title
                  WHEN 'To Do' THEN v_col_todo
                  WHEN 'In Progress' THEN v_col_prog
                  ELSE v_col_done
                END;

    INSERT INTO public.tasks
      (title, description, column_id, assigned_to, created_by, position,
       priority, status, visibility)
    VALUES
      (rec.title, rec.description, v_col_id, v_vanshaj, v_vanshaj, rec.position,
       3, rec.status, 'assigned')
    RETURNING id INTO v_task_id;

    INSERT INTO public.task_assignees (task_id, user_id)
    VALUES (v_task_id, v_vanshaj)
    ON CONFLICT (task_id, user_id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Imported V''s PM Portal: board %, 28 tasks assigned to Vanshaj (%).', v_board_id, v_vanshaj;
END $$;

COMMIT;

-- Verification
SELECT c.title AS column, t.status, COUNT(*) AS tasks
FROM public.boards b
JOIN public.columns c ON c.board_id = b.id
JOIN public.tasks t ON t.column_id = c.id
WHERE b.title = 'V''s PM Portal'
GROUP BY c.title, c.position, t.status
ORDER BY c.position, t.status;
