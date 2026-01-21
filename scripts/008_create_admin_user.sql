-- Create the admin user bobby@goatlasgo.us with password Ic3Ic3

-- First, check if user already exists and delete if needed
DO $$
DECLARE
  user_id uuid;
BEGIN
  -- Check for existing user in auth.users
  SELECT id INTO user_id
  FROM auth.users
  WHERE email = 'bobby@goatlasgo.us';

  -- If user exists, delete them and their profile
  IF user_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = user_id;
    DELETE FROM auth.users WHERE id = user_id;
  END IF;
END $$;

-- Create the admin user with hashed password
-- The password 'Ic3Ic3' will be hashed by Supabase
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'bobby@goatlasgo.us',
  crypt('Ic3Ic3', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Bobby Admin"}',
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
);

-- Create the profile for the admin user
INSERT INTO public.profiles (id, full_name, role, created_at, updated_at)
SELECT 
  id,
  'Bobby Admin',
  'admin',
  NOW(),
  NOW()
FROM auth.users
WHERE email = 'bobby@goatlasgo.us';

-- Verify the user was created
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at,
  p.full_name,
  p.role
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE u.email = 'bobby@goatlasgo.us';
