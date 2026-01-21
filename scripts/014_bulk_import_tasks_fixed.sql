-- Bulk import tasks for Data board
-- First, get the Data board ID and column IDs
DO $$
DECLARE
    v_board_id uuid;
    v_todo_column_id uuid;
    v_progress_column_id uuid;
    v_done_column_id uuid;
    v_admin_id uuid;
BEGIN
    -- Get Data board ID
    SELECT id INTO v_board_id FROM boards WHERE title = 'Data' LIMIT 1;
    
    -- Get or create columns
    SELECT id INTO v_todo_column_id FROM columns WHERE board_id = v_board_id AND title = 'To Do' LIMIT 1;
    SELECT id INTO v_progress_column_id FROM columns WHERE board_id = v_board_id AND title = 'In Progress' LIMIT 1;
    SELECT id INTO v_done_column_id FROM columns WHERE board_id = v_board_id AND title = 'Done' LIMIT 1;
    
    -- Get admin user ID
    SELECT id INTO v_admin_id FROM profiles WHERE role = 'admin' LIMIT 1;

    -- Insert tasks from Image 1 (Active/Pending tasks)
    INSERT INTO tasks (title, description, column_id, priority, status, due_date, created_by, position) VALUES
    ('Create webpage for Seckman area homes', 'Create a webpage that displays ALL the "active" and "pending" homes for sale anywhere in the Seckman area.', v_todo_column_id, 'high', 'to_do', '2025-03-01'::timestamp, v_admin_id, 0),
    ('Easter Egg Hunt', 'Fill paperwork for Mastodon. How many eggs total? Bunny Suit. Picture area. Grand prizes. Arts and craft table. Company banner. 10x10 tent. adult to kid ratio estimated at 50/50.', v_todo_column_id, 'high', 'to_do', '2026-03-28'::timestamp, v_admin_id, 1),
    ('Movie Night', '', v_todo_column_id, 'high', 'to_do', '2026-05-01'::timestamp, v_admin_id, 2),
    ('Call Jefferson county - mobile advertising permit', 'Call Jefferson county and see if there is a permit needed to drive a mobile advertising board', v_todo_column_id, 'high', 'to_do', NULL, v_admin_id, 3),
    ('Flags on new lamppost along Seckman Rd', 'sending docs to StateFarm for Surety Bond', v_todo_column_id, 'medium', 'to_do', '2025-12-31'::timestamp, v_admin_id, 4),
    ('Budget and choose SWAG for 2026', 'Need to budget and choose SWAG for each quarter in 2026.', v_todo_column_id, 'medium', 'to_do', '2026-01-31'::timestamp, v_admin_id, 5),
    ('Design two sided biz card for Bobby', 'Design and order a two sided biz card for Bobby. SRG & AGC, one on each side', v_todo_column_id, 'medium', 'to_do', '2026-02-14'::timestamp, v_admin_id, 6),
    ('Implement landing pages', 'Bobby/Cami/Kayla', v_todo_column_id, 'medium', 'to_do', '2026-03-31'::timestamp, v_admin_id, 7),
    ('Brochure for AGC - exterior', 'Hold until 01/01/26', v_todo_column_id, 'low', 'to_do', '2026-03-31'::timestamp, v_admin_id, 8),
    ('Patch for phone number for garage sale banners', 'The next garage sale will be the end of April', v_todo_column_id, 'low', 'to_do', '2026-03-31'::timestamp, v_admin_id, 9),
    ('Choose email marketing system', '', v_todo_column_id, 'high', 'to_do', '2025-11-25'::timestamp, v_admin_id, 10),
    ('Setup email marketing software with spreadsheet database', '', v_todo_column_id, 'high', 'to_do', '2025-12-05'::timestamp, v_admin_id, 11),
    ('Setup template and begin campaign', '', v_todo_column_id, 'high', 'to_do', '2025-12-05'::timestamp, v_admin_id, 12);

    -- Insert tasks from Image 2 - On Going Indefinitely
    INSERT INTO tasks (title, description, column_id, priority, status, due_date, created_by, position) VALUES
    ('Facebook Atlas page weekly post', 'Twice a week', v_progress_column_id, 'low', 'in_progress', NULL, v_admin_id, 0),
    ('Facebook Bobby/SRG page weekly post', 'Twice a week', v_progress_column_id, 'low', 'in_progress', NULL, v_admin_id, 1),
    ('Before & After Pix Constantly', '', v_progress_column_id, 'medium', 'in_progress', NULL, v_admin_id, 2);

    -- Insert tasks from Image 2 - COMPLETED
    INSERT INTO tasks (title, description, column_id, priority, status, due_date, created_by, position) VALUES
    ('Website For AGC', 'Cami and Kayla', v_done_column_id, 'high', 'done', '2025-08-15'::timestamp, v_admin_id, 0),
    ('Brochure for AGC - Gen Purp', 'Cami', v_done_column_id, 'high', 'done', '2025-07-25'::timestamp, v_admin_id, 1),
    ('Get stickers for ACG hats for kids', 'waiting on hats - Cami', v_done_column_id, 'high', 'done', '2025-07-21'::timestamp, v_admin_id, 2),
    ('Hard hats for crew 5 orange', 'Cami', v_done_column_id, 'high', 'done', '2025-07-21'::timestamp, v_admin_id, 3),
    ('Stickers for real hard hats w/names', '', v_done_column_id, 'low', 'done', NULL, v_admin_id, 4),
    ('Bobby, Create drive with all logos and before and afters', 'Bobby''s computer waiting', v_done_column_id, 'high', 'done', NULL, v_admin_id, 5),
    ('Business Cards AGC', 'Bobby''s computer waiting - Cami', v_done_column_id, 'medium', 'done', NULL, v_admin_id, 6),
    ('Elijah 200 biz cards', 'Cami', v_done_column_id, 'low', 'done', '2025-10-10'::timestamp, v_admin_id, 7),
    ('Kimberly 200 Biz cards', 'Kimberly Smith. Kim.AtlasGC@gmail.com. Ms 314.808.5069 - Cami', v_done_column_id, 'low', 'done', '2025-10-10'::timestamp, v_admin_id, 8),
    ('Banner for seckman football game', 'Cami', v_done_column_id, 'low', 'done', '2025-10-13'::timestamp, v_admin_id, 9),
    ('Banner for Seckman Rd Facebook Seckman-Y', 'Cami', v_done_column_id, 'low', 'done', '2025-10-17'::timestamp, v_admin_id, 10),
    ('Order construction yellow T-Shirts', 'Due for delivery on 10/17 - Cami', v_done_column_id, 'medium', 'done', '2025-10-17'::timestamp, v_admin_id, 11),
    ('Find out about grants', 'ditch this one, waste of time, just keep your eyes open - Cami', v_done_column_id, 'medium', 'done', '2025-10-31'::timestamp, v_admin_id, 12),
    ('Lee Olin Business cards "Project Manager"', 'Delivered Oct 24th', v_done_column_id, 'low', 'done', NULL, v_admin_id, 13),
    ('Film recruitment video for AGC', '', v_done_column_id, 'low', 'done', NULL, v_admin_id, 14),
    ('Drone Repair', 'Done and delivered Oct 23rd - Cami', v_done_column_id, 'medium', 'done', '2025-10-31'::timestamp, v_admin_id, 15),
    ('5x3 ft Seckman Community Page Banner', 'Cami', v_done_column_id, 'medium', 'done', '2025-10-08'::timestamp, v_admin_id, 16),
    ('Signup for SGAR Affiliate Program', 'Kogan will be the one assigned. - Bobby/Kogan', v_done_column_id, 'low', 'done', '2025-11-25'::timestamp, v_admin_id, 17),
    ('Make corrections to brochure and print 200+ more', 'Cami', v_done_column_id, 'low', 'done', '2025-12-05'::timestamp, v_admin_id, 18),
    ('Pickup yard signs from ABC', 'Waiting on John to tell us they''ve arrived. - Bobby', v_done_column_id, 'medium', 'done', '2025-12-15'::timestamp, v_admin_id, 19),
    ('Purchase 100 Xmas cards and send to VIPs', 'purchased 12/2: Never got them from Cami. - Cami', v_done_column_id, 'low', 'done', '2025-12-17'::timestamp, v_admin_id, 20),
    ('Share all IP native files with Bobby', 'Never got this. - Cami', v_done_column_id, 'high', 'done', NULL, v_admin_id, 21);

    -- Insert tasks from Image 3 (Current Tasks)
    INSERT INTO tasks (title, description, column_id, priority, status, due_date, created_by, position) VALUES
    ('"Got Roof" Banner for ATLAS', 'Hold until next monday 10/20 and we''ll review then', v_todo_column_id, 'low', 'to_do', '2025-12-05'::timestamp, v_admin_id, 13),
    ('Surety Bond', 'need to contact insurance county', v_todo_column_id, 'low', 'to_do', '2025-12-05'::timestamp, v_admin_id, 14),
    ('Logo to Jaguar Animation for BBall Scoreboard', '', v_todo_column_id, 'low', 'to_do', '2025-12-05'::timestamp, v_admin_id, 15),
    ('Make 365 marketing calendar/spreadsheet', '', v_todo_column_id, 'low', 'to_do', '2025-12-09'::timestamp, v_admin_id, 16),
    ('Insert button into AGC website for Handyman', '', v_todo_column_id, 'low', 'to_do', '2026-01-31'::timestamp, v_admin_id, 17),
    ('Identify eagles and send direct mail piece plus email', 'Need to identify our eagles and mail them. Prob 50-80 people.', v_todo_column_id, 'medium', 'to_do', '2025-12-18'::timestamp, v_admin_id, 18),
    ('Schedule pictures/video for Rose Miller Home', 'Get with Tim Kennon', v_todo_column_id, 'medium', 'to_do', '2025-12-31'::timestamp, v_admin_id, 19),
    ('Schedule pictures/video for Rick Myer', 'Get with Tim Kennon', v_todo_column_id, 'medium', 'to_do', '2025-12-31'::timestamp, v_admin_id, 20),
    ('Schedule pictures/video of TJ/s bar', 'Get with Tim Kennon', v_todo_column_id, 'medium', 'to_do', '2025-12-31'::timestamp, v_admin_id, 21),
    ('Website for SRG', 'Waiting on DEC or after Jan 1.', v_todo_column_id, 'medium', 'to_do', '2026-03-31'::timestamp, v_admin_id, 22);

END $$;
