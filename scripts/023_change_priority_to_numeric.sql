-- Change priority system from text (low/medium/high) to numeric (1-5)
-- First, add a new numeric column
ALTER TABLE tasks ADD COLUMN priority_numeric INTEGER DEFAULT 3;

-- Convert existing priorities
UPDATE tasks SET priority_numeric = 1 WHERE priority = 'low';
UPDATE tasks SET priority_numeric = 3 WHERE priority = 'medium';
UPDATE tasks SET priority_numeric = 5 WHERE priority = 'high';

-- Drop old column and rename new one
ALTER TABLE tasks DROP COLUMN priority;
ALTER TABLE tasks RENAME COLUMN priority_numeric TO priority;

-- Add check constraint to ensure valid values
ALTER TABLE tasks ADD CONSTRAINT priority_range CHECK (priority >= 1 AND priority <= 5);
