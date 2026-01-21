-- Setup domain-based authentication for goatlasgo.us
-- This script sets up the super admin and configures domain-based access

-- First, drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can only read allowed emails" ON allowed_emails;
DROP POLICY IF EXISTS "Only admins can manage allowed emails" ON allowed_emails;

-- Drop the allowed_emails table since we're using domain-based auth now
DROP TABLE IF EXISTS allowed_emails CASCADE;

-- Update profiles table to include full_name
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Update RLS policies to allow any @goatlasgo.us email
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create a function to check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT email = 'bobby@goatlasgo.us'
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update board policies to check super admin
DROP POLICY IF EXISTS "Admins can manage all boards" ON boards;
CREATE POLICY "Admins can manage all boards"
  ON boards FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "Users can view their assigned boards" ON boards;
CREATE POLICY "Users can view their assigned boards"
  ON boards FOR SELECT
  USING (
    is_super_admin() OR
    id IN (
      SELECT DISTINCT board_id 
      FROM columns c
      JOIN tasks t ON t.column_id = c.id
      WHERE t.assigned_to = auth.uid()
    )
  );

-- Update task policies
DROP POLICY IF EXISTS "Admins can manage all tasks" ON tasks;
CREATE POLICY "Admins can manage all tasks"
  ON tasks FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "Users can view assigned tasks" ON tasks;
CREATE POLICY "Users can view assigned tasks"
  ON tasks FOR SELECT
  USING (
    is_super_admin() OR
    assigned_to = auth.uid()
  );

DROP POLICY IF EXISTS "Users can update assigned tasks" ON tasks;
CREATE POLICY "Users can update assigned tasks"
  ON tasks FOR UPDATE
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

-- Update column policies
DROP POLICY IF EXISTS "Admins can manage all columns" ON columns;
CREATE POLICY "Admins can manage all columns"
  ON columns FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "Users can view columns of their boards" ON columns;
CREATE POLICY "Users can view columns of their boards"
  ON columns FOR SELECT
  USING (
    is_super_admin() OR
    board_id IN (
      SELECT DISTINCT c.board_id
      FROM columns c
      JOIN tasks t ON t.column_id = c.id
      WHERE t.assigned_to = auth.uid()
    )
  );

-- Ensure super admin profile exists (will be created on first login)
-- This is handled by the trigger automatically
