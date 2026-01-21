-- Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can manage all profiles" ON profiles;

DROP POLICY IF EXISTS "Users can view boards they're assigned to" ON boards;
DROP POLICY IF EXISTS "Admin can manage all boards" ON boards;

DROP POLICY IF EXISTS "Users can view columns in their boards" ON columns;
DROP POLICY IF EXISTS "Admin can manage all columns" ON columns;

DROP POLICY IF EXISTS "Users can view tasks in their boards" ON tasks;
DROP POLICY IF EXISTS "Users can update their assigned tasks" ON tasks;
DROP POLICY IF EXISTS "Admin can manage all tasks" ON tasks;

DROP POLICY IF EXISTS "Users can view chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can send chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON chat_messages;
DROP POLICY IF EXISTS "Admin can manage all messages" ON chat_messages;

-- Drop and recreate the allowed_emails table (we're keeping it but will allow all @goatlasgo.us)
DROP TABLE IF EXISTS allowed_emails CASCADE;

-- Update profiles table to add full_name and ensure is_admin exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create a function to check if email is from allowed domain
CREATE OR REPLACE FUNCTION is_goatlasgo_email(email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN email LIKE '%@goatlasgo.us';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Set bobby@goatlasgo.us as admin if the user exists in auth.users
-- First, let's create a trigger function to automatically create profile and set admin
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, is_admin, full_name, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.email = 'bobby@goatlasgo.us',
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NOW()
  )
  ON CONFLICT (id) 
  DO UPDATE SET
    email = EXCLUDED.email,
    is_admin = EXCLUDED.is_admin,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger for new user signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update existing bobby@goatlasgo.us user to be admin if exists
UPDATE profiles 
SET is_admin = true 
WHERE email = 'bobby@goatlasgo.us';

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admin can manage all profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Boards policies
CREATE POLICY "Users can view boards they're assigned to"
  ON boards FOR SELECT
  TO authenticated
  USING (
    is_admin_user() OR 
    id IN (
      SELECT DISTINCT board_id 
      FROM tasks 
      WHERE assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admin can manage all boards"
  ON boards FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Columns policies
CREATE POLICY "Users can view columns in their boards"
  ON columns FOR SELECT
  TO authenticated
  USING (
    is_admin_user() OR 
    board_id IN (
      SELECT DISTINCT board_id 
      FROM tasks 
      WHERE assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admin can manage all columns"
  ON columns FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Tasks policies
CREATE POLICY "Users can view tasks in their boards"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    is_admin_user() OR 
    assigned_to = auth.uid() OR
    board_id IN (
      SELECT DISTINCT board_id 
      FROM tasks 
      WHERE assigned_to = auth.uid()
    )
  );

CREATE POLICY "Users can update their assigned tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

CREATE POLICY "Admin can manage all tasks"
  ON tasks FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Chat messages policies
CREATE POLICY "Users can view chat messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (
    is_admin_user() OR 
    sender_id = auth.uid() OR 
    receiver_id = auth.uid()
  );

CREATE POLICY "Users can send chat messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND
    (is_admin_user() OR receiver_id IN (SELECT id FROM profiles WHERE is_admin = true))
  );

CREATE POLICY "Users can delete own messages"
  ON chat_messages FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "Admin can manage all messages"
  ON chat_messages FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
