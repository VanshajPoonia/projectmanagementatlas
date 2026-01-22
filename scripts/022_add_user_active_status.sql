-- Add active status column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Update all existing users to be active by default
UPDATE profiles SET is_active = true WHERE is_active IS NULL;

-- Add comment
COMMENT ON COLUMN profiles.is_active IS 'Whether the user account is active and can log in';
