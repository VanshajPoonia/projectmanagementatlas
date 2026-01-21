-- Import tasks into Data board with proper column IDs
-- Board: Data (f4cf7fb9-1e05-4ccc-8539-1edf6780a6f0)
-- Bobby Admin: 3c870a86-bfb7-4755-8abf-c4a1f847b8e8

-- Get column IDs for reference
DO $$
DECLARE
  v_board_id UUID := 'f4cf7fb9-1e05-4ccc-8539-1edf6780a6f0';
  v_bobby_id UUID := '3c870a86-bfb7-4755-8abf-c4a1f847b8e8';
  v_to_do_col UUID;
  v_in_progress_col UUID;
  v_done_col UUID;
  v_review_col UUID;
BEGIN
  -- Get or create To Do column
  SELECT id INTO v_to_do_col FROM columns WHERE board_id = v_board_id AND title = 'To Do';
  IF v_to_do_col IS NULL THEN
    INSERT INTO columns (board_id, title, position) VALUES (v_board_id, 'To Do', 0) RETURNING id INTO v_to_do_col;
  END IF;

  -- Get In Progress column (or use existing columns)
  SELECT id INTO v_in_progress_col FROM columns WHERE board_id = v_board_id AND title IN ('In Progress', 'Working', 'In Process') LIMIT 1;
  
  -- Get Done column
  SELECT id INTO v_done_col FROM columns WHERE board_id = v_board_id AND title = 'Done' LIMIT 1;
  IF v_done_col IS NULL THEN
    INSERT INTO columns (board_id, title, position) VALUES (v_board_id, 'Done', 999) RETURNING id INTO v_done_col;
  END IF;

  -- Import TO DO / PENDING tasks
  INSERT INTO tasks (title, description, column_id, priority, due_date, status, position, created_by) VALUES
  ('Create webpage for Seckman area homes', 'Display ALL the "active" and "pending" homes for sale anywhere in the Seckman area', v_to_do_col, 'high', '2025-03-01'::timestamp, 'to_do', 0, v_bobby_id),
  ('Easter Egg Hunt', 'Fill paperwork for Mastodon. How many eggs total? Bunny Suit. Picture area. Grand prizes. Arts and craft table. Company banner. 10x10 tent. Adult to kid ratio estimated at 50/50.', v_to_do_col, 'high', '2026-03-28'::timestamp, 'to_do', 1, v_bobby_id),
  ('Movie Night', '', v_to_do_col, 'high', '2026-01-05'::timestamp, 'to_do', 2, v_bobby_id),
  ('Mobile advertising board permit', 'Call Jefferson county and see if there is a permit needed to drive a mobile advertising board', v_to_do_col, 'high', NULL, 'to_do', 3, v_bobby_id),
  ('Flags on new lamppost', 'Flags on new lamppost along Seckman Rd', v_to_do_col, 'medium', '2025-12-31'::timestamp, 'to_do', 4, v_bobby_id),
  ('Budget SWAG for 2026', 'Need to budget and choose SWAG for each quarter in 2026', v_to_do_col, 'medium', '2026-01-31'::timestamp, 'to_do', 5, v_bobby_id),
  ('Two sided biz card for Bobby', 'Design and order a two sided biz card for Bobby. SRG & AGC, one on each side', v_to_do_col, 'medium', '2026-02-14'::timestamp, 'to_do', 6, v_bobby_id),
  ('Implement landing pages', 'Bobby/Cami/Kayla', v_to_do_col, 'medium', '2026-03-31'::timestamp, 'to_do', 7, v_bobby_id),
  ('Brochure for AGC - exterior', 'Hold until 01/01/26', v_to_do_col, 'low', '2026-03-31'::timestamp, 'to_do', 8, v_bobby_id),
  ('Patch phone number for garage sale banners', 'The next garage sale will be the end of April', v_to_do_col, 'low', '2026-03-31'::timestamp, 'to_do', 9, v_bobby_id),
  ('"Got Roof" Banner for ATLAS', 'Hold until next monday 10/20 and we''ll review then', v_to_do_col, 'high', '2025-12-05'::timestamp, 'to_do', 10, v_bobby_id),
  ('Surety Bond', 'need to contact insurance county', v_to_do_col, 'high', '2025-12-05'::timestamp, 'to_do', 11, v_bobby_id),
  ('Logo to Jaguar Animation for BBall Scoreboard', '', v_to_do_col, 'high', '2025-12-05'::timestamp, 'to_do', 12, v_bobby_id),
  ('365 marketing calendar/spreadsheet', '', v_to_do_col, 'high', '2025-12-09'::timestamp, 'to_do', 13, v_bobby_id),
  ('Insert button into AGC website for Handyman', '', v_to_do_col, 'high', '2026-01-31'::timestamp, 'to_do', 14, v_bobby_id),
  ('Identify eagles and send direct mail', 'Need to identify our eagles and mail them. Prob 50-80 people.', v_to_do_col, 'medium', '2025-12-18'::timestamp, 'to_do', 15, v_bobby_id),
  ('Schedule pictures/video for Rose Miller Home', 'Get with Tim Kennon', v_to_do_col, 'medium', '2025-12-31'::timestamp, 'to_do', 16, v_bobby_id),
  ('Schedule pictures/video for Rick Myer', 'Get with Tim Kennon', v_to_do_col, 'medium', '2025-12-31'::timestamp, 'to_do', 17, v_bobby_id),
  ('Schedule pictures/video of TJ/s bar', 'Get with Tim Kennon', v_to_do_col, 'medium', '2025-12-31'::timestamp, 'to_do', 18, v_bobby_id),
  ('Website for SRG', 'Waiting on DEC or after Jan 1.', v_to_do_col, 'medium', '2026-03-31'::timestamp, 'to_do', 19, v_bobby_id);

  -- Import ONGOING tasks
  INSERT INTO tasks (title, description, column_id, priority, due_date, status, position, created_by) VALUES
  ('Facebook Atlas page weekly post', 'Twice a week', COALESCE(v_in_progress_col, v_to_do_col), 'high', NULL, 'in_progress', 0, v_bobby_id),
  ('Facebook Bobby/SRG page weekly post', 'Twice a week', COALESCE(v_in_progress_col, v_to_do_col), 'high', NULL, 'in_progress', 1, v_bobby_id),
  ('Before & After Pix Constantly', '', COALESCE(v_in_progress_col, v_to_do_col), 'medium', NULL, 'in_progress', 2, v_bobby_id),
  ('Choose email marketing system', '', COALESCE(v_in_progress_col, v_to_do_col), 'high', '2025-11-25'::timestamp, 'in_progress', 3, v_bobby_id),
  ('Setup email marketing software with spreadsheet database', '', COALESCE(v_in_progress_col, v_to_do_col), 'high', '2025-12-05'::timestamp, 'in_progress', 4, v_bobby_id),
  ('Setup template and begin campaign', '', COALESCE(v_in_progress_col, v_to_do_col), 'high', '2025-12-05'::timestamp, 'in_progress', 5, v_bobby_id);

  -- Import COMPLETED tasks
  IF v_done_col IS NOT NULL THEN
    INSERT INTO tasks (title, description, column_id, priority, due_date, status, position, created_by) VALUES
    ('Website For AGC', '', v_done_col, 'high', '2025-08-15'::timestamp, 'done', 0, v_bobby_id),
    ('Brochure for AGC - Gen Purp', '', v_done_col, 'high', '2025-07-25'::timestamp, 'done', 1, v_bobby_id),
    ('Get stickers for ACG hats for kids', 'waiting on hats', v_done_col, 'high', '2025-07-21'::timestamp, 'done', 2, v_bobby_id),
    ('Hard hats for crew 5 orange', '', v_done_col, 'high', '2025-07-21'::timestamp, 'done', 3, v_bobby_id),
    ('Stickers for real hard hats w/names', '', v_done_col, 'high', NULL, 'done', 4, v_bobby_id),
    ('Bobby, Create drive with all logos and before and afters', 'Bobby''s computer waiting', v_done_col, 'high', NULL, 'done', 5, v_bobby_id),
    ('Business Cards AGC', 'Bobby''s computer waiting', v_done_col, 'medium', NULL, 'done', 6, v_bobby_id),
    ('Elijah 200 biz cards', '', v_done_col, 'high', '2025-10-10'::timestamp, 'done', 7, v_bobby_id),
    ('Kimberly 200 Biz cards', 'Kimberly Smith. Kim.AtlasGC@gmail.com. MS 314.808.5069', v_done_col, 'high', '2025-10-10'::timestamp, 'done', 8, v_bobby_id),
    ('Banner for seckman football game', '', v_done_col, 'high', '2025-10-13'::timestamp, 'done', 9, v_bobby_id),
    ('Banner for Seckman Rd Facebook Seckman-Y', '', v_done_col, 'high', '2025-10-17'::timestamp, 'done', 10, v_bobby_id),
    ('Order construction yellow T-Shirts', 'Due for delivery on 10/17', v_done_col, 'medium', '2025-10-17'::timestamp, 'done', 11, v_bobby_id),
    ('Find out about grants', 'ditch this one, waste of time, just keep your eyes open', v_done_col, 'medium', '2025-10-31'::timestamp, 'done', 12, v_bobby_id),
    ('Lee Olin Business cards "Project Manager"', 'Delivered Oct 24th', v_done_col, 'high', NULL, 'done', 13, v_bobby_id),
    ('Film recruitment video for AGC', '', v_done_col, 'high', NULL, 'done', 14, v_bobby_id),
    ('Drone Repair', 'Done and delivered Oct 23rd', v_done_col, 'medium', '2025-10-31'::timestamp, 'done', 15, v_bobby_id),
    ('5x3 ft Seckman Community Page Banner', '', v_done_col, 'medium', '2025-10-08'::timestamp, 'done', 16, v_bobby_id),
    ('Signup for SGAR Affiliate Program', 'Kogan will be the one assigned.', v_done_col, 'high', '2025-11-25'::timestamp, 'done', 17, v_bobby_id),
    ('Make corrections to brochure and print 200+ more', '', v_done_col, 'high', '2025-12-05'::timestamp, 'done', 18, v_bobby_id),
    ('Pickup yard signs from ABC', 'Waiting on John to tell us they''ve arrived.', v_done_col, 'medium', '2025-12-15'::timestamp, 'done', 19, v_bobby_id),
    ('Purchase 100 Xmas cards', 'purchased 12/2: Never got them from Cami.', v_done_col, 'high', '2025-12-17'::timestamp, 'done', 20, v_bobby_id),
    ('Share all IP native files with Bobby', 'Never got this.', v_done_col, 'high', NULL, 'done', 21, v_bobby_id);
  END IF;
END $$;
