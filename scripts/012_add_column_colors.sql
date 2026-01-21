-- Add color field to columns table for customization
ALTER TABLE columns ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#6366f1';

-- Update existing columns with default colors
UPDATE columns SET color = '#6366f1' WHERE color IS NULL;
