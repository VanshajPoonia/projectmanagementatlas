-- Priority scale is flipping: was 1=lowest/5=highest, now 1=highest/5=lowest.
-- Invert existing values so already-set priorities keep their real-world meaning.
BEGIN;
UPDATE tasks SET priority = 6 - priority WHERE priority IS NOT NULL;
COMMIT;
