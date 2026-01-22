-- Reassign unassigned tasks to team members
-- This script assigns all unassigned tasks to Kayla, Vanshaj, Kogan, and Bobby

-- First, let's see what we're working with
SELECT 
  COUNT(*) as total_tasks,
  COUNT(CASE WHEN assigned_to IS NULL THEN 1 END) as unassigned_tasks
FROM tasks;

-- Get user IDs
DO $$
DECLARE
  kayla_id UUID := (SELECT id FROM profiles WHERE email = 'kayla@goatlasgo.us');
  vanshaj_id UUID := (SELECT id FROM profiles WHERE email = 'vanshaj@goatlasgo.us');
  kogan_id UUID := (SELECT id FROM profiles WHERE email = 'kogan@goatlasgo.us');
  bobby_id UUID := (SELECT id FROM profiles WHERE email = 'bobby@goatlasgo.us');
BEGIN
  -- Show the IDs we're using
  RAISE NOTICE 'Kayla ID: %', kayla_id;
  RAISE NOTICE 'Vanshaj ID: %', vanshaj_id;
  RAISE NOTICE 'Kogan ID: %', kogan_id;
  RAISE NOTICE 'Bobby ID: %', bobby_id;

  -- Update tasks based on the assignment patterns from the spreadsheet
  -- Assign tasks that were for "Kayla" to Kayla
  UPDATE tasks SET assigned_to = kayla_id 
  WHERE title ILIKE '%calendar%' OR title ILIKE '%spreadsheet%';

  -- Assign tasks for Vanshaj
  UPDATE tasks SET assigned_to = vanshaj_id
  WHERE title ILIKE '%logo%' OR title ILIKE '%handyman%' OR title ILIKE '%website for SRG%';

  -- Assign tasks for Kogan
  UPDATE tasks SET assigned_to = kogan_id
  WHERE title ILIKE '%affiliate%' AND assigned_to IS NULL;

  -- Assign Bobby's tasks
  UPDATE tasks SET assigned_to = bobby_id
  WHERE (title ILIKE '%banner%' OR title ILIKE '%signs%' OR title ILIKE '%eagles%' OR title ILIKE '%permit%')
  AND assigned_to IS NULL;

  -- For remaining unassigned tasks, distribute them to Kayla (as per request)
  UPDATE tasks SET assigned_to = kayla_id
  WHERE assigned_to IS NULL;
END $$;

-- Verify the results
SELECT 
  p.full_name,
  COUNT(t.id) as task_count
FROM profiles p
LEFT JOIN tasks t ON t.assigned_to = p.id
GROUP BY p.id, p.full_name
ORDER BY p.full_name;

COMMIT;
