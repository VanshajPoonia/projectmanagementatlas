-- Domain-based authentication setup for @goatlasgo.us
-- This script configures the system to allow any @goatlasgo.us email to sign up
-- and sets bobby@goatlasgo.us as the super admin

-- First, let's ensure we have a proper name column (using full_name which already exists)
-- No need to add it since it already exists

-- Drop and recreate the trigger function for auto-creating profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create function to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    CASE 
      WHEN new.email = 'bobby@goatlasgo.us' THEN 'admin'
      ELSE 'user'
    END,
    now(),
    now()
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call function when new user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update bobby@goatlasgo.us to be admin if profile already exists
UPDATE public.profiles 
SET role = 'admin', updated_at = now()
WHERE email = 'bobby@goatlasgo.us';

-- Also update in auth.users metadata
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'bobby@goatlasgo.us';
