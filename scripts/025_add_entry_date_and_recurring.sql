-- Add entry_date field (auto-generated when task completed)
-- Add recurring task fields
-- Add created_by field to track task creator

ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS entry_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recurrence_pattern VARCHAR(50), -- 'daily', 'weekly', 'monthly'
ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1, -- Every X days/weeks/months
ADD COLUMN IF NOT EXISTS recurrence_end_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- Add index for recurring tasks queries
CREATE INDEX IF NOT EXISTS idx_tasks_recurring ON tasks(is_recurring) WHERE is_recurring = TRUE;

-- Add index for created_by
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

COMMENT ON COLUMN tasks.entry_date IS 'Auto-generated timestamp when task status changes to completed (non-editable)';
COMMENT ON COLUMN tasks.is_recurring IS 'Whether this task recurs on a schedule';
COMMENT ON COLUMN tasks.recurrence_pattern IS 'Frequency: daily, weekly, monthly';
COMMENT ON COLUMN tasks.recurrence_interval IS 'Recur every X periods (e.g., every 2 weeks)';
COMMENT ON COLUMN tasks.created_by IS 'User who created the task (only they can edit due_date)';
