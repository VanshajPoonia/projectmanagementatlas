-- Delete Cami user and reassign all tasks to Kayla

-- First, get Kayla's ID and Cami's ID
DO $$
DECLARE
    kayla_id UUID;
    cami_id UUID;
BEGIN
    -- Find Kayla's ID
    SELECT id INTO kayla_id FROM profiles WHERE full_name ILIKE '%kayla%' OR email ILIKE '%kayla%' LIMIT 1;
    
    -- Find Cami's ID
    SELECT id INTO cami_id FROM profiles WHERE full_name ILIKE '%cami%' OR email ILIKE '%cami%' LIMIT 1;
    
    IF kayla_id IS NOT NULL AND cami_id IS NOT NULL THEN
        -- Reassign all tasks from Cami to Kayla
        UPDATE tasks 
        SET assigned_to = kayla_id 
        WHERE assigned_to = cami_id;
        
        -- Reassign tasks created by Cami to Kayla
        UPDATE tasks 
        SET created_by = kayla_id 
        WHERE created_by = cami_id;
        
        -- Update chat messages sender
        UPDATE chat_messages 
        SET sender_id = kayla_id 
        WHERE sender_id = cami_id;
        
        -- Update chat messages recipient
        UPDATE chat_messages 
        SET recipient_id = kayla_id 
        WHERE recipient_id = cami_id;
        
        -- Delete from profiles (this will cascade delete from auth.users if RLS allows)
        DELETE FROM profiles WHERE id = cami_id;
        
        RAISE NOTICE 'Successfully reassigned all tasks from Cami to Kayla and deleted Cami';
    ELSE
        RAISE NOTICE 'Could not find Kayla ID: % or Cami ID: %', kayla_id, cami_id;
    END IF;
END $$;
