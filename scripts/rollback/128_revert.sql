-- Revert 128 (owner decisions).
--
-- ⚠️ THIS DESTROYS EVERY RECORDED DECISION AND ITS RESOLUTION HISTORY. That history is the one
-- thing here that cannot be reconstructed: the notes say what was decided and why, six months
-- after everyone has forgotten. If the intent is "roll back the code, keep the log", dump the
-- table first:
--   pg_dump "$POSTGRES_URL_NON_POOLING" -t public.owner_decisions -Fc -f owner-decisions.dump
--
-- It touches no other table, policy or grant.

BEGIN;

DROP TRIGGER IF EXISTS enforce_owner_decision_state ON public.owner_decisions;
DROP FUNCTION IF EXISTS private.enforce_owner_decision_state();
DROP TABLE IF EXISTS public.owner_decisions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'owner_decisions') THEN
    RAISE EXCEPTION 'owner_decisions still exists. Aborting.';
  END IF;
  RAISE NOTICE '128 reverted: owner_decisions removed.';
END $$;

COMMIT;
