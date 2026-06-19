-- Import active + indefinitely ongoing rows from:
-- /Users/vanshajpoonia/Downloads/Marketing Project Management.xlsx
-- Sheet: "Main PM Sheet"
--
-- Imports:
-- - Rows 2-44: active task block, excluding blank rows 40-43
-- - Rows 55-57: "On Going Indefinitely"
-- Excludes:
-- - Rows 60+: "COMPLETED"
--
-- Run this in Supabase SQL Editor.
-- Optional: run scripts/027_clear_workspace_data.sql first if you want a fully clean database.
--
-- Notes:
-- - Creates/uses a board named "Main PM Sheet".
-- - Creates two columns: "Tasks" and "On Going Indefinitely".
-- - Preserves Company as board tags: ALL, HM, AGC, SRG.
-- - Preserves all source details in task.description.
-- - Assigns users by matching profiles.full_name or profile email prefix.
-- - If a named assignee is not found in profiles, the task remains unassigned
--   for that person, but the original assignee text is preserved in description.

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  board_id UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, board_id)
);

CREATE TABLE IF NOT EXISTS public.task_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, tag_id)
);

ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3b82f6';
ALTER TABLE public.columns ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#6366f1';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'to_do';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS entry_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_pattern VARCHAR(50);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_task_assignees_task_id ON public.task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user_id ON public.task_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_board_id ON public.tags(board_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON public.task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON public.task_tags(tag_id);

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_assignees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_tags TO authenticated;

DROP POLICY IF EXISTS "Users can view task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Admins can manage task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can view all tags" ON public.tags;
DROP POLICY IF EXISTS "Only admins can create tags" ON public.tags;
DROP POLICY IF EXISTS "Only admins can update tags" ON public.tags;
DROP POLICY IF EXISTS "Only admins can delete tags" ON public.tags;
DROP POLICY IF EXISTS "Users can view all task_tags" ON public.task_tags;
DROP POLICY IF EXISTS "Only admins can create task_tags" ON public.task_tags;
DROP POLICY IF EXISTS "Only admins can delete task_tags" ON public.task_tags;

CREATE POLICY "Users can view task assignees"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admins can manage task assignees"
  ON public.task_assignees FOR ALL
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

CREATE POLICY "Users can view all tags"
  ON public.tags FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Only admins can create tags"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

CREATE POLICY "Only admins can update tags"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

CREATE POLICY "Only admins can delete tags"
  ON public.tags FOR DELETE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

CREATE POLICY "Users can view all task_tags"
  ON public.task_tags FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Only admins can create task_tags"
  ON public.task_tags FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

CREATE POLICY "Only admins can delete task_tags"
  ON public.task_tags FOR DELETE
  TO authenticated
  USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

DO $$
DECLARE
  v_creator_id UUID;
  v_board_id UUID;
  v_tasks_column_id UUID;
  v_ongoing_column_id UUID;
  v_task_id UUID;
  v_tag_id UUID;
  v_primary_assignee_id UUID;
  v_assignee_id UUID;
  v_assignee_name TEXT;
  rec RECORD;
BEGIN
  SELECT id
  INTO v_creator_id
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at NULLS LAST, email
  LIMIT 1;

  IF v_creator_id IS NULL THEN
    SELECT id
    INTO v_creator_id
    FROM public.profiles
    ORDER BY created_at NULLS LAST, email
    LIMIT 1;
  END IF;

  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'No profile exists. Create at least one user/profile before importing tasks.';
  END IF;

  SELECT id
  INTO v_board_id
  FROM public.boards
  WHERE title = 'Main PM Sheet'
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  IF v_board_id IS NULL THEN
    INSERT INTO public.boards (title, description, created_by, color)
    VALUES (
      'Main PM Sheet',
      'Imported from Marketing Project Management.xlsx > Main PM Sheet. Completed rows intentionally excluded.',
      v_creator_id,
      '#2563eb'
    )
    RETURNING id INTO v_board_id;
  ELSE
    UPDATE public.boards
    SET
      description = 'Imported from Marketing Project Management.xlsx > Main PM Sheet. Completed rows intentionally excluded.',
      color = '#2563eb'
    WHERE id = v_board_id;

    DELETE FROM public.columns WHERE board_id = v_board_id;
    DELETE FROM public.tags WHERE board_id = v_board_id;
  END IF;

  INSERT INTO public.columns (board_id, title, position, color)
  VALUES (v_board_id, 'Tasks', 0, '#2563eb')
  RETURNING id INTO v_tasks_column_id;

  INSERT INTO public.columns (board_id, title, position, color)
  VALUES (v_board_id, 'On Going Indefinitely', 1, '#16a34a')
  RETURNING id INTO v_ongoing_column_id;

  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('tasks', 0,  'Make 365 marketing calendar/spreadsheet', 1, '1', DATE '2026-05-01', DATE '2026-06-12', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 1,  'Migrate AGC clients in HOUZZ to Brevo', 1, '1', DATE '2026-05-28', NULL, 'perpetual', 'ALL', 'last import (6/4/2026)', 'Kayla', ARRAY['Kayla']::TEXT[], TRUE, NULL, NULL),
        ('tasks', 2,  'Shane Schaper Email address', 1, '1', DATE '2026-05-28', DATE '2026-06-01', NULL, 'ALL', 'shane@goATLASgo.us', 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 3,  'SRG Google "organic" Reviews & Website', 1, '1', DATE '2026-05-22', DATE '2026-08-31', NULL, 'ALL', 'In progress we send a reveiw in every 3-4 days', 'Kayla/Vanshaj', ARRAY['Kayla', 'Vanshaj']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 4,  'Partner with Home Depot and Lowes to see if they have some sort of a referral program or certified Handyman program or something like that https://thdserviceprovider.my.site.com/pro/becomeapro?source=store&STOREID=3014', 1, '1', DATE '2026-06-16', DATE '2026-06-19', NULL, 'HM', 'bobby@goatlasgo.us should have received an email on 6/17/26 around 9:39am', 'Kayla/Vanshaj', ARRAY['Kayla', 'Vanshaj']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 5,  'Identifiy eagles and send them a direct mail piece plus email', 2, '2', DATE '2025-11-25', DATE '2025-12-18', NULL, 'ALL', '12/18/25', 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 6,  'Roofing Contractor in IL paperwork', 2, '2', DATE '2026-05-20', NULL, NULL, 'AGC', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 7,  'Send friend requests and IG follows to the members of AU. Uploaded video with all the members names.', 2, '2', DATE '2026-05-30', NULL, NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 8,  'Figure out pricing for Brevo to be able to have more contacts', 2, '2', DATE '2026-06-04', DATE '2026-07-01', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 9,  'Create a Google review QR code for ATLAS', 2, '2', DATE '2026-06-09', DATE '2026-06-10', NULL, 'AGC', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 10, 'Bike Parade section on website non year specfic', 2, '2', DATE '2026-06-11', DATE '2026-06-12', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 11, 'Get with Beth Smith @ SGR to particpate more often', 2, '2', DATE '2026-06-08', NULL, 'Perpetual', 'HM', NULL, 'Shane', ARRAY['Shane']::TEXT[], TRUE, NULL, NULL),
        ('tasks', 12, 'Send a quarterly home-maintenance reminder with seasonal repair checklists and a clear CTA to book a handyman visit. (1) AGC past clients (2) Selected SRG EAgles (3) Handwritten note that is photocopied (4) Address and stamp all envelopes (5) Put note & cardinals magnet in envelope (6) Deliver to the post office', 2, '2', DATE '2026-06-09', NULL, 'Quarterly', 'HM', 'Handyman Emails', 'Kayla/Sierra', ARRAY['Kayla', 'Sierra']::TEXT[], TRUE, 'monthly', 3),
        ('tasks', 13, 'Investigate Houzz scheduling and any sales automation', 2, '2', DATE '2026-06-09', DATE '2026-06-25', NULL, 'HM', NULL, 'Brian', ARRAY['Brian']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 14, 'Call some of the local military bases and see if it would be possible for a platoon to come to our parking lot and do either marching or drills', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 15, 'Create an easy brochure that is specific to strip center property owners and then have a day that those go and get handed out or put in the mail.', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 16, 'Take our current pamphlet around to all of the northern Jefferson County and South County brokerages and hand them to the brokers and/or ask if they can be added to the card drop area', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 17, 'Take several brochures and pin them on public boards, such as at bread, Company or other restaurants', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 18, 'Call Laura Lohman and ask her about being an advertiser on the bathroom, digital boards and the Festus restaurants', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 19, 'Need to design a marketing piece about offering financing', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 20, 'Need to create a workflow so that when we post something on social media that everyone that is affiliated with our company can be tagged and or share', 2, '2', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 21, 'Website for SRG', 3, '3', DATE '2025-07-15', DATE '2026-07-15', NULL, 'SRG', 'Waiting on DEC or after Jan 1.', 'Kayla/Vanshaj', ARRAY['Kayla', 'Vanshaj']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 22, 'Create a webpage that displays ALL the "active" and "pending" homes for sale anywhere in the Seckman area.', 3, '3', DATE '2025-12-08', DATE '2025-03-01', NULL, 'SRG', NULL, 'Kayla/Vanshaj', ARRAY['Kayla', 'Vanshaj']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 23, 'Movie Night', 3, '3', DATE '2026-01-05', DATE '2026-10-01', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 24, 'Tradeshow Booth', 3, '3', DATE '2026-06-09', DATE '2026-07-01', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 25, 'Begin and continuisouly develope a Handyman Handbook', 3, '3', DATE '2026-06-08', NULL, 'Perpetual', 'HM', '3 ring binder', 'Shane', ARRAY['Shane']::TEXT[], TRUE, NULL, NULL),
        ('tasks', 26, 'develope yardsigns for handyman', 3, '3', DATE '2026-06-08', DATE '2026-06-24', NULL, 'HM', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 27, 'order handyman yardsigns "I HEART My Handyman, Ph #" "Everyone Needs A Handyman, Ph # "Everyone WANTS my Handyman, Ph #" "...for when your husband didn''t deliver, Handyman, Ph #" "Honey Do List, Checkbox, DONE, Handyman, Ph #" "One Call Fixes It All, Handyman Service, Ph #"', 3, '3', DATE '2026-06-08', DATE '2026-06-24', NULL, 'HM', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 28, 'Srg. Need a localized campaign that emphasizes experience as the value prop Linda Friedrich in Waterloo', 3, '3', DATE '2026-06-16', DATE '2026-08-01', NULL, 'SRG', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 29, 'Design and order a two sided biz card for Bobby. SRG & AGC, one on each side', 4, '4', DATE '2025-12-08', DATE '2026-08-01', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 30, 'Need to budget and choose SWAG for each quarter in 2026.', 4, '4', DATE '2025-12-03', NULL, 'Quarterly', 'AGC', 'Send out a swag item per the 1-3-5. See bobby for the list.', 'Kayla', ARRAY['Kayla']::TEXT[], TRUE, 'monthly', 3),
        ('tasks', 31, 'Flags on new lamppost along Seckman Rd', 4, '4', DATE '2025-10-03', DATE '2026-08-01', NULL, 'ALL', 'sending docs to StateFarm for Surety Bond', 'Kayla/Bobby', ARRAY['Kayla', 'Bobby']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 32, 'implement landing pages', 4, '4', DATE '2025-12-03', NULL, NULL, 'SRG', NULL, 'Kayla/Vanshaj', ARRAY['Kayla', 'Vanshaj']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 33, 'Quarterly email of seasonal things to do with your house.', 4, '4', DATE '2026-06-16', NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('tasks', 34, 'Easter Egg Hunt', 5, '5', DATE '2026-01-05', DATE '2027-03-28', NULL, 'ALL', 'Fill paperwork for Mastodon. How many eggs total? Bunny Suit. Picture area. Grand prizes. Arts and craft table. Company banner. 10x10 tent. adult to kid ratio estimated at 50/50.', 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 35, 'Banner out front show casing our new handyman service Big and simple?, like the yard sign idea Use the logo or don''t? 6'' wide x 4'' tall or 3'' tall', 5, '5', DATE '2026-06-16', NULL, NULL, 'SRG', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 36, 'AGC Google "organic" Reviews & Website', 3, 'HOLD', DATE '2026-05-22', NULL, '07/156/26', 'AGC', NULL, 'Bobby', ARRAY['Bobby']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 37, 'V-ROD PM/TASK Manager Need to be able to export literally everything into a single flat CSV file to import in to excel.', 1, '1', DATE '2026-06-16', DATE '2026-06-30', NULL, 'ALL', NULL, 'Kayla', ARRAY['Kayla']::TEXT[], FALSE, NULL, NULL),
        ('tasks', 38, 'Some type of campaign focused on going to Property Manager''s and offering the Handyman service', 3, NULL, NULL, NULL, NULL, 'HM', NULL, NULL, ARRAY[]::TEXT[], FALSE, NULL, NULL),
        ('ongoing', 0, 'Facebook Atlas page weekly post', 1, '1', DATE '2025-07-15', NULL, 'Perpetual', NULL, 'three times a week', NULL, ARRAY[]::TEXT[], TRUE, 'weekly', 1),
        ('ongoing', 1, 'Facebook Bobby/SRG page weekly post', 1, '1', DATE '2025-07-15', NULL, 'Perpetual', NULL, 'three times a week', NULL, ARRAY[]::TEXT[], TRUE, 'weekly', 1),
        ('ongoing', 2, 'Before & After Pix Constantly', 2, '2', DATE '2025-10-03', NULL, 'Perpetual', NULL, NULL, NULL, ARRAY[]::TEXT[], TRUE, NULL, NULL)
    ) AS source_rows(
      section,
      position,
      title,
      priority,
      source_priority,
      entry_date,
      due_date,
      due_label,
      company,
      notes,
      assigned_raw,
      assignee_names,
      is_recurring,
      recurrence_pattern,
      recurrence_interval
    )
  LOOP
    v_primary_assignee_id := NULL;

    FOREACH v_assignee_name IN ARRAY rec.assignee_names LOOP
      v_assignee_id := NULL;

      SELECT id
      INTO v_assignee_id
      FROM public.profiles
      WHERE
        lower(coalesce(full_name, '')) = lower(v_assignee_name)
        OR lower(email) = lower(v_assignee_name || '@goatlasgo.us')
        OR lower(email) LIKE lower(v_assignee_name || '@%')
        OR lower(coalesce(full_name, '')) LIKE '%' || lower(v_assignee_name) || '%'
      ORDER BY
        CASE
          WHEN lower(coalesce(full_name, '')) = lower(v_assignee_name) THEN 0
          WHEN lower(email) = lower(v_assignee_name || '@goatlasgo.us') THEN 1
          WHEN lower(email) LIKE lower(v_assignee_name || '@%') THEN 2
          ELSE 3
        END,
        email
      LIMIT 1;

      IF v_assignee_id IS NOT NULL AND v_primary_assignee_id IS NULL THEN
        v_primary_assignee_id := v_assignee_id;
      END IF;
    END LOOP;

    INSERT INTO public.tasks (
      title,
      description,
      column_id,
      assigned_to,
      created_by,
      position,
      priority,
      due_date,
      entry_date,
      status,
      is_recurring,
      recurrence_pattern,
      recurrence_interval
    )
    VALUES (
      rec.title,
      concat_ws(
        E'\n',
        'Source: Marketing Project Management.xlsx > Main PM Sheet',
        'Section: ' || CASE WHEN rec.section = 'ongoing' THEN 'On Going Indefinitely' ELSE 'Tasks' END,
        'Task Description: ' || rec.title,
        CASE WHEN rec.company IS NOT NULL THEN 'Company: ' || rec.company END,
        CASE
          WHEN rec.source_priority IS NOT NULL THEN 'Priority: ' || rec.source_priority
          ELSE 'Priority: Not listed in sheet'
        END,
        CASE WHEN rec.entry_date IS NOT NULL THEN 'Entry Date: ' || rec.entry_date::TEXT END,
        'Due Date: ' || coalesce(rec.due_label, rec.due_date::TEXT, 'No due date'),
        'Assigned To: ' || coalesce(rec.assigned_raw, 'Unassigned'),
        CASE WHEN rec.notes IS NOT NULL THEN 'Notes & Status: ' || rec.notes END
      ),
      CASE WHEN rec.section = 'ongoing' THEN v_ongoing_column_id ELSE v_tasks_column_id END,
      v_primary_assignee_id,
      v_creator_id,
      rec.position,
      rec.priority,
      rec.due_date,
      rec.entry_date,
      CASE WHEN rec.section = 'ongoing' THEN 'in_progress' ELSE 'to_do' END,
      rec.is_recurring,
      rec.recurrence_pattern,
      coalesce(rec.recurrence_interval, 1)
    )
    RETURNING id INTO v_task_id;

    FOREACH v_assignee_name IN ARRAY rec.assignee_names LOOP
      v_assignee_id := NULL;

      SELECT id
      INTO v_assignee_id
      FROM public.profiles
      WHERE
        lower(coalesce(full_name, '')) = lower(v_assignee_name)
        OR lower(email) = lower(v_assignee_name || '@goatlasgo.us')
        OR lower(email) LIKE lower(v_assignee_name || '@%')
        OR lower(coalesce(full_name, '')) LIKE '%' || lower(v_assignee_name) || '%'
      ORDER BY
        CASE
          WHEN lower(coalesce(full_name, '')) = lower(v_assignee_name) THEN 0
          WHEN lower(email) = lower(v_assignee_name || '@goatlasgo.us') THEN 1
          WHEN lower(email) LIKE lower(v_assignee_name || '@%') THEN 2
          ELSE 3
        END,
        email
      LIMIT 1;

      IF v_assignee_id IS NOT NULL THEN
        INSERT INTO public.task_assignees (task_id, user_id)
        VALUES (v_task_id, v_assignee_id)
        ON CONFLICT (task_id, user_id) DO NOTHING;
      END IF;
    END LOOP;

    IF rec.company IS NOT NULL THEN
      INSERT INTO public.tags (name, color, board_id)
      VALUES (
        rec.company,
        CASE rec.company
          WHEN 'ALL' THEN '#2563eb'
          WHEN 'HM' THEN '#16a34a'
          WHEN 'AGC' THEN '#f59e0b'
          WHEN 'SRG' THEN '#dc2626'
          ELSE '#6b7280'
        END,
        v_board_id
      )
      ON CONFLICT (name, board_id) DO UPDATE SET color = EXCLUDED.color
      RETURNING id INTO v_tag_id;

      INSERT INTO public.task_tags (task_id, tag_id)
      VALUES (v_task_id, v_tag_id)
      ON CONFLICT (task_id, tag_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verification summary
SELECT
  b.title AS board,
  c.title AS column,
  COUNT(t.id) AS task_count
FROM public.boards b
JOIN public.columns c ON c.board_id = b.id
LEFT JOIN public.tasks t ON t.column_id = c.id
WHERE b.title = 'Main PM Sheet'
GROUP BY b.title, c.title, c.position
ORDER BY c.position;
