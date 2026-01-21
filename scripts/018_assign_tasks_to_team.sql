-- Assign tasks to team members based on spreadsheet data
-- Run this AFTER creating the users via the API

-- Update tasks assigned to Bobby
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'bobby@goatlasgo.us')
WHERE title IN (
  '"Got Roof" Banner for ATLAS to advertise our exterior work',
  'Surety Bond',
  'Logo to Jaguar Animation for BBall Scoreboard',
  'Identify eagles and send them a direct mail piece plus email',
  'Schedule pictures/video for Rose Miller Home',
  'Schedule pictures/video for Rick Myer',
  'Schedule pictures/video of TJ/s bar',
  'Call Jefferson county and see if there is a permit needed to drive a mobile advertising board',
  'Pickup yard signs from ABC'
);

-- Update tasks assigned to Cami
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'cami@goatlasgo.us')
WHERE title IN (
  'Website For AGC',
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
  'Lee Olin Business cards "Project Manager"',
  'Drone Repair',
  '5x3 ft Seckman Community Page Banner',
  'Make corrections to brochure and print 200+ more',
  'Purchase 100 Xmas cards and we''ll send them out to our VIPs',
  'Share all IP native files with Bobby',
  'Easter Egg Hunt',
  'Movie Night'
);

-- Update tasks assigned to Kayla
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'kayla@goatlasgo.us')
WHERE title IN (
  'make 365 marketing calendar/spreadsheet',
  'Website for SRG'
);

-- Update tasks assigned to Vanshaj
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'vanshaj@goatlasgo.us')
WHERE title IN (
  'Insert button into AGC website for Handyman'
);

-- Update tasks assigned to Bobby/Kogan (shared assignment - assign to Bobby for now)
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'bobby@goatlasgo.us')
WHERE title = 'Signup for SGAR Affiliate Program';

-- Update tasks with multiple assignees mentioned in notes
UPDATE tasks SET assigned_to = (SELECT id FROM profiles WHERE email = 'kayla@goatlasgo.us')
WHERE title = 'implement landing pages' AND description LIKE '%Bobby/Cami/Kayla%';

COMMIT;
