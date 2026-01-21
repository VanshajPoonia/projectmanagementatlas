-- Add missing foreign key constraints to tasks table

-- Add foreign key for assigned_to referencing profiles
ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;

ALTER TABLE tasks
ADD CONSTRAINT tasks_assigned_to_fkey
FOREIGN KEY (assigned_to)
REFERENCES profiles(id)
ON DELETE SET NULL;

-- Add foreign key for created_by referencing profiles  
ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;

ALTER TABLE tasks
ADD CONSTRAINT tasks_created_by_fkey
FOREIGN KEY (created_by)
REFERENCES profiles(id)
ON DELETE SET NULL;

-- Add foreign key for boards.created_by referencing profiles
ALTER TABLE boards
DROP CONSTRAINT IF EXISTS boards_created_by_fkey;

ALTER TABLE boards
ADD CONSTRAINT boards_created_by_fkey
FOREIGN KEY (created_by)
REFERENCES profiles(id)
ON DELETE SET NULL;

-- Add foreign key for chat_messages.sender_id referencing profiles
ALTER TABLE chat_messages
DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;

ALTER TABLE chat_messages
ADD CONSTRAINT chat_messages_sender_id_fkey
FOREIGN KEY (sender_id)
REFERENCES profiles(id)
ON DELETE CASCADE;

-- Add foreign key for chat_messages.recipient_id referencing profiles
ALTER TABLE chat_messages
DROP CONSTRAINT IF EXISTS chat_messages_recipient_id_fkey;

ALTER TABLE chat_messages
ADD CONSTRAINT chat_messages_recipient_id_fkey
FOREIGN KEY (recipient_id)
REFERENCES profiles(id)
ON DELETE CASCADE;
