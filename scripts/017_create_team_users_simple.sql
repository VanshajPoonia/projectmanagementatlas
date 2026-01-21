-- First, let's create user IDs for the team members
-- Note: These are profile entries. For actual login, users need to be created via Supabase Auth signup

-- Insert team member profiles with generated UUIDs
INSERT INTO profiles (id, email, full_name, role)
VALUES 
  (gen_random_uuid(), 'cami@goatlasgo.us', 'Cami', 'user'),
  (gen_random_uuid(), 'kayla@goatlasgo.us', 'Kayla', 'user'),
  (gen_random_uuid(), 'vanshaj@goatlasgo.us', 'Vanshaj', 'user'),
  (gen_random_uuid(), 'kogan@goatlasgo.us', 'Kogan', 'user');

-- Now update task assignments based on the spreadsheet data
-- Get the user IDs we just created
DO $$
DECLARE
  cami_id uuid;
  kayla_id uuid;
  vanshaj_id uuid;
  kogan_id uuid;
  bobby_id uuid;
BEGIN
  -- Get user IDs
  SELECT id INTO cami_id FROM profiles WHERE email = 'cami@goatlasgo.us';
  SELECT id INTO kayla_id FROM profiles WHERE email = 'kayla@goatlasgo.us';
  SELECT id INTO vanshaj_id FROM profiles WHERE email = 'vanshaj@goatlasgo.us';
  SELECT id INTO kogan_id FROM profiles WHERE email = 'kogan@goatlasgo.us';
  SELECT id INTO bobby_id FROM profiles WHERE email = 'bobby@goatlasgo.us';

  -- Update task assignments based on spreadsheet data
  -- Tasks assigned to Bobby
  UPDATE tasks SET assigned_to = bobby_id WHERE title IN (
    '"Got Roof" Banner for ATLAS to advertise our exterior work',
    'Surety Bond',
    'Call Jefferson county and see if there is a permit needed to drive a mobile advertising board',
    'Design and order a two sided biz card for Bobby. SRG & AGC, one on each side',
    'Identify eagles and send them a direct mail piece plus email',
    'Schedule pictures/video for Rose Miller Home',
    'Schedule pictures/video for Rick Myer',
    'Schedule pictures/video of TJ/s bar',
    'Pickup yard signs from ABC'
  );

  -- Tasks assigned to Cami
  UPDATE tasks SET assigned_to = cami_id WHERE title IN (
    'Brochure for AGC - Gen Purp',
    'Get stickers for ACG hats for kids',
    'Hard hats for crew 5 orange',
    'Business Cards AGC',
    'Elijah 200 biz cards',
    'Kimberly 200 Biz cards',
    'Banner for seckman football game',
    'Banner for Seckman Rd Facebook Seckman-Y',
    'Order construction yellow T-Shirts',
    'Find out about grants',
    'Film recruitment video for AGC',
    'Drone Repair',
    '5x3 ft Seckman Community Page Banner',
    'Make corrections to brochure and print 200+ more',
    'Purchase 100 Xmas cards and we''ll send them out to our VIPs',
    'Share all IP native files with Bobby'
  );

  -- Tasks assigned to Kayla
  UPDATE tasks SET assigned_to = kayla_id WHERE title IN (
    'make 365 marketing calendar/spreadsheet',
    'Website for SRG'
  );

  -- Tasks assigned to Vanshaj
  UPDATE tasks SET assigned_to = vanshaj_id WHERE title IN (
    'Logo to Jaguar Animation for BBall Scoreboard',
    'Insert button into AGC website for Handyman'
  );

  -- Tasks assigned to Bobby/Kogan
  UPDATE tasks SET assigned_to = bobby_id WHERE title = 'Signup for SGAR Affiliate Program';

  -- Tasks with multiple assignees or special notes - assign to primary person
  UPDATE tasks SET assigned_to = cami_id WHERE title = 'Website For AGC';
  UPDATE tasks SET assigned_to = kayla_id WHERE title = 'implement landing pages';
  UPDATE tasks SET assigned_to = bobby_id WHERE title IN (
    'Need to budget and choose SWAG for each quarter in 2026.',
    'Flags on new lamppost along Seckman Rd',
    'Brochure for AGC - exterior',
    'Patch for phone number for garage sale banners'
  );

  -- Email marketing tasks
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%(1)%Choose email marketing system%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%(2)%Setup email marketing software%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%(3)%Setup template and begin campaign%';

  -- Ongoing tasks
  UPDATE tasks SET assigned_to = bobby_id WHERE title IN (
    'Facebook Atlas page weekly post',
    'Facebook Bobby/SRG page weekly post',
    'Before & After Pix Constantly'
  );

END $$;

COMMIT;

-- Display created users
SELECT id, email, full_name, role FROM profiles WHERE email LIKE '%@goatlasgo.us' ORDER BY email;
