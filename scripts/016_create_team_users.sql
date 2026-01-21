-- Create team user accounts
-- Password for all: Ic3Ic3

-- Insert Cami
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
VALUES (
  gen_random_uuid(),
  'cami@goatlasgo.us',
  crypt('Ic3Ic3', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"full_name": "Cami"}'::jsonb
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Insert Kayla
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
VALUES (
  gen_random_uuid(),
  'kayla@goatlasgo.us',
  crypt('Ic3Ic3', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"full_name": "Kayla"}'::jsonb
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Insert Vanshaj
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
VALUES (
  gen_random_uuid(),
  'vanshaj@goatlasgo.us',
  crypt('Ic3Ic3', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"full_name": "Vanshaj"}'::jsonb
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Insert Kogan
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
VALUES (
  gen_random_uuid(),
  'kogan@goatlasgo.us',
  crypt('Ic3Ic3', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"full_name": "Kogan"}'::jsonb
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Profiles will be auto-created by trigger
-- Now update task assignments based on the spreadsheet data

-- Get user IDs
DO $$
DECLARE
  cami_id uuid;
  kayla_id uuid;
  vanshaj_id uuid;
  kogan_id uuid;
  bobby_id uuid;
BEGIN
  SELECT id INTO cami_id FROM profiles WHERE email = 'cami@goatlasgo.us';
  SELECT id INTO kayla_id FROM profiles WHERE email = 'kayla@goatlasgo.us';
  SELECT id INTO vanshaj_id FROM profiles WHERE email = 'vanshaj@goatlasgo.us';
  SELECT id INTO kogan_id FROM profiles WHERE email = 'kogan@goatlasgo.us';
  SELECT id INTO bobby_id FROM profiles WHERE email = 'bobby@goatlasgo.us';

  -- Update assignments based on spreadsheet data
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Got Roof%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Surety Bond%';
  UPDATE tasks SET assigned_to = vanshaj_id WHERE title LIKE '%Logo to Jaguar%';
  UPDATE tasks SET assigned_to = kayla_id WHERE title LIKE '%365 marketing%';
  UPDATE tasks SET assigned_to = vanshaj_id WHERE title LIKE '%Insert button%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Identify eagles%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Schedule pictures%Rose Miller%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Schedule pictures%Rick Myer%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Schedule pictures%TJ%';
  UPDATE tasks SET assigned_to = kayla_id WHERE title LIKE '%Website for SRG%' OR title LIKE '%landing pages%';
  UPDATE tasks SET assigned_to = vanshaj_id WHERE title LIKE '%Website for SRG%' OR title LIKE '%landing pages%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Website For AGC%';
  UPDATE tasks SET assigned_to = kayla_id WHERE title LIKE '%Website For AGC%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Brochure for AGC - Gen Purp%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Get stickers for ACG%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Hard hats for crew%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Stickers for real hard%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Bobby, Create drive%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Business Cards AGC%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Elijah 200%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Kimberly 200%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Banner for seckman football%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Banner for Seckman Rd%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Order construction yellow%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Find out about grants%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Film recruitment%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Drone Repair%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%5x3 ft Seckman%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Signup for SGAR%';
  UPDATE tasks SET assigned_to = kogan_id WHERE title LIKE '%Signup for SGAR%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Make corrections to brochure%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Pickup yard signs%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Purchase 100 Xmas%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Share all IP native%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Easter Egg Hunt%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Movie Night%';
  UPDATE tasks SET assigned_to = bobby_id WHERE title LIKE '%Design and order%two sided%';
  UPDATE tasks SET assigned_to = cami_id WHERE title LIKE '%Design and order%two sided%';
  UPDATE tasks SET assigned_to = kayla_id WHERE title LIKE '%Design and order%two sided%';

END $$;

COMMIT;
