-- Create admin user bobby@goatlasgo.us with password Ic3Ic3
-- This script creates the user in auth.users and sets up the admin profile

DO $$
DECLARE
  admin_user_id uuid;
  hashed_password text;
BEGIN
  -- Generate a UUID for the admin user
  admin_user_id := gen_random_uuid();
  
  -- Hash the password 'Ic3Ic3' using crypt
  hashed_password := crypt('Ic3Ic3', gen_salt('bf'));
  
  -- Check if user already exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'bobby@goatlasgo.us') THEN
    -- Insert into auth.users
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      aud,
      role
    ) VALUES (
      admin_user_id,
      '00000000-0000-0000-0000-000000000000',
      'bobby@goatlasgo.us',
      hashed_password,
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Bobby Admin"}',
      'authenticated',
      'authenticated'
    );
    
    -- Insert into auth.identities
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      admin_user_id,
      jsonb_build_object('sub', admin_user_id::text, 'email', 'bobby@goatlasgo.us'),
      'email',
      now(),
      now(),
      now()
    );
    
    -- Create profile with admin role
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      role,
      created_at,
      updated_at
    ) VALUES (
      admin_user_id,
      'bobby@goatlasgo.us',
      'Bobby Admin',
      'admin',
      now(),
      now()
    );
    
    RAISE NOTICE 'Admin user bobby@goatlasgo.us created successfully with password Ic3Ic3';
  ELSE
    -- User exists, update to admin if needed
    SELECT id INTO admin_user_id FROM auth.users WHERE email = 'bobby@goatlasgo.us';
    
    -- Update profile to admin
    UPDATE public.profiles 
    SET role = 'admin',
        full_name = 'Bobby Admin',
        email = 'bobby@goatlasgo.us'
    WHERE id = admin_user_id;
    
    RAISE NOTICE 'User bobby@goatlasgo.us already exists, updated role to admin';
  END IF;
END $$;
