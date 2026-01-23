-- Add color column to boards table for customization
ALTER TABLE boards ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#3b82f6';

-- Add comment
COMMENT ON COLUMN boards.color IS 'Hex color code for board icon customization';
