-- Bulk import tasks from spreadsheet data
-- First, let's get the Data board ID and column IDs

-- Insert tasks into appropriate columns
-- Priority mapping: 1=high, 2=high, 3=medium, 4=low, 5=low

-- ACTIVE TASKS (To Do column)
INSERT INTO tasks (title, description, priority, due_date, status, column_id, created_by, position) 
SELECT 
  task_title,
  task_description,
  task_priority,
  task_due_date,
  'to_do',
  (SELECT id FROM columns WHERE board_id = (SELECT id FROM boards WHERE title = 'Data') AND title = 'To Do' LIMIT 1),
  (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1),
  ROW_NUMBER() OVER ()
FROM (VALUES
  ('Create webpage for Seckman area homes', 'Create a webpage that displays ALL the "active" and "pending" homes for sale anywhere in the Seckman area.', 'high', '2026-03-01'),
  ('Easter Egg Hunt', 'Fill paperwork for Mastodon. How many eggs total? Bunny Suit. Picture area. Grand prizes. Arts and craft table. Company banner. 10x10 tent. adult to kid ratio estimated at 50/50.', 'high', '2026-03-28'),
  ('Movie Night', '', 'high', '2026-01-05'),
  ('Mobile advertising board permit', 'Call Jefferson county and see if there is a permit needed to drive a mobile advertising board', 'high', '2025-12-11'),
  ('Flags on new lamppost', 'Flags on new lamppost along Seckman Rd', 'medium', '2025-12-31'),
  ('Budget and choose SWAG for 2026', 'Need to budget and choose SWAG for each quarter in 2026.', 'medium', '2026-01-31'),
  ('Design two sided biz card for Bobby', 'Design and order a two sided biz card for Bobby. SRG & AGC, one on each side', 'medium', '2026-02-14'),
  ('Implement landing pages', '', 'medium', '2026-03-31'),
  ('Brochure for AGC - exterior', 'Hold until 01/01/26', 'low', '2026-03-31'),
  ('Patch phone number for garage sale banners', 'The next garage sale will be the end of April', 'low', '2026-03-31'),
  ('"Got Roof" Banner for ATLAS', 'Hold until next monday 10/20 and we''ll review then', 'high', '2025-12-05'),
  ('Surety Bond', 'need to contact insurance county', 'high', '2025-12-05'),
  ('Logo to Jaguar Animation for BBall Scoreboard', '', 'high', '2025-12-05'),
  ('Make 365 marketing calendar/spreadsheet', '', 'high', '2025-12-09'),
  ('Insert button into AGC website for Handyman', '', 'high', '2026-01-31'),
  ('Identify eagles and send direct mail', 'Need to identify our eagles and mail them. Prob 50-80 people.', 'medium', '2025-12-18'),
  ('Schedule pictures/video for Rose Miller Home', 'Get with Tim Kennon', 'medium', '2025-12-31'),
  ('Schedule pictures/video for Rick Myer', 'Get with Tim Kennon', 'medium', '2025-12-31'),
  ('Schedule pictures/video of TJ/s bar', 'Get with Tim Kennon', 'medium', '2025-12-31'),
  ('Website for SRG', 'Waiting on DEC or after Jan 1.', 'medium', '2026-03-31')
) AS t(task_title, task_description, task_priority, task_due_date);

-- ONGOING TASKS (In Progress column)
INSERT INTO tasks (title, description, priority, due_date, status, column_id, created_by, position)
SELECT 
  task_title,
  task_description,
  task_priority,
  task_due_date,
  'in_progress',
  (SELECT id FROM columns WHERE board_id = (SELECT id FROM boards WHERE title = 'Data') AND title = 'In Progress' LIMIT 1),
  (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1),
  ROW_NUMBER() OVER ()
FROM (VALUES
  ('Facebook Atlas page weekly post', 'Perpetual - Twice a week', 'high', NULL),
  ('Facebook Bobby/SRG page weekly post', 'Perpetual - Twice a week', 'high', NULL),
  ('Before & After Pix Constantly', 'Perpetual', 'high', NULL)
) AS t(task_title, task_description, task_priority, task_due_date);

-- COMPLETED TASKS (Done column)
INSERT INTO tasks (title, description, priority, due_date, status, column_id, created_by, position, completed_at)
SELECT 
  task_title,
  task_description,
  task_priority,
  task_due_date,
  'done',
  (SELECT id FROM columns WHERE board_id = (SELECT id FROM boards WHERE title = 'Data') AND title = 'Done' LIMIT 1),
  (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1),
  ROW_NUMBER() OVER (),
  task_completed_at
FROM (VALUES
  ('Website For AGC', 'Assigned to Cami and Kayla', 'high', '2025-08-15', '2025-08-15'),
  ('Brochure for AGC - Gen Purp', 'Assigned to Cami', 'high', '2025-07-25', '2025-07-25'),
  ('Get stickers for ACG hats for kids', 'waiting on hats - Assigned to Cami', 'high', '2025-07-21', '2025-07-21'),
  ('Hard hats for crew 5 orange', 'Assigned to Cami', 'high', '2025-07-21', '2025-07-21'),
  ('Stickers for real hard hats w/names', '', 'high', NULL, '2025-07-15'),
  ('Bobby, Create drive with all logos and before and afters', 'Bobby''s computer waiting - Assigned to Bobby', 'high', NULL, '2025-07-21'),
  ('Business Cards AGC', 'Bobby''s computer waiting - Assigned to Cami', 'high', NULL, '2025-07-15'),
  ('Elijah 200 biz cards', 'Assigned to Cami', 'high', '2025-10-10', '2025-09-29'),
  ('Kimberly 200 Biz cards', 'Kimberly Smith. Kim.AtlasGC@gmail.com. MS: 314.808.5069 - Assigned to Cami', 'high', '2025-10-10', '2025-10-08'),
  ('Banner for seckman football game', 'Assigned to Cami', 'high', '2025-10-13', '2025-10-09'),
  ('Banner for Seckman Rd Facebook Seckman-Y', 'Assigned to Cami', 'high', '2025-10-17', '2025-09-25'),
  ('Order construction yellow T-Shirts', 'Due for delivery on 10/17 - Assigned to Cami', 'medium', '2025-10-17', '2025-09-15'),
  ('Find out about grants', 'ditch this one, waste of time, just keep your eyes open - Assigned to Cami', 'medium', '2025-10-31', '2025-10-03'),
  ('Lee Olin Business cards "Project Manager"', 'Delivered Oct 24th - Assigned to Cami', 'high', NULL, '2025-10-21'),
  ('Film recruitment video for AGC', '', 'high', NULL, '2025-09-15'),
  ('Drone Repair', 'Done and delivered Oct 23rd - Assigned to Cami', 'medium', '2025-10-31', '2025-09-15'),
  ('5x3 ft Seckman Community Page Banner', 'Assigned to Cami', 'medium', '2025-10-08', '2025-09-29'),
  ('Signup for SGAR Affiliate Program', 'Kogan will be the one assigned. - Assigned to Bobby/Kogan', 'high', '2025-11-25', '2025-11-25'),
  ('Make corrections to brochure and print 200+ more', 'Assigned to Cami', 'high', '2025-12-05', '2025-11-25'),
  ('Pickup yard signs from ABC', 'Waiting on John to tell us they''ve arrived. - Assigned to Bobby', 'medium', '2025-12-15', '2025-12-03'),
  ('Purchase 100 Xmas cards', 'purchased 12/2: Never got them from Cami. - Assigned to Cami', 'high', '2025-12-17', '2025-11-25'),
  ('Share all IP native files with Bobby', 'Perpetual - Never got this. - Assigned to Cami', 'high', NULL, '2025-07-28')
) AS t(task_title, task_description, task_priority, task_due_date, task_completed_at);

-- EMAIL MARKETING TASKS (create as subtasks or separate tasks)
INSERT INTO tasks (title, description, priority, due_date, status, column_id, created_by, position)
SELECT 
  task_title,
  task_description,
  task_priority,
  task_due_date,
  'to_do',
  (SELECT id FROM columns WHERE board_id = (SELECT id FROM boards WHERE title = 'Data') AND title = 'To Do' LIMIT 1),
  (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1),
  ROW_NUMBER() OVER () + 100
FROM (VALUES
  ('(1) Choose email marketing system', '', 'high', '2025-11-25'),
  ('(2) Setup email marketing software with spreadsheet database', '', 'high', '2025-12-05'),
  ('(3) Setup template and begin campaign', '', 'high', '2025-12-05')
) AS t(task_title, task_description, task_priority, task_due_date);
