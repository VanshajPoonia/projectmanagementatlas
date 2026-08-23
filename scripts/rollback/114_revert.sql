-- Revert 114: remove the custom-field engine.
--
-- ⚠️ DESTROYS EVERY CUSTOM FIELD VALUE, and the definitions that give them meaning. Unlike a
-- status or a type, a field value is data a person typed and nothing else records it - there
-- is no second copy to reconstruct it from. Dump both tables first if the intent is "roll back
-- the code, keep the data":
--
--   \copy public.field_definitions to 'field_definitions.csv' csv header
--   \copy public.field_values      to 'field_values.csv'      csv header
--
-- Destroys nothing else: tasks, boards and work item types are untouched.

BEGIN;

DROP TRIGGER IF EXISTS validate_field_value ON public.field_values;
DROP TRIGGER IF EXISTS set_field_values_updated_at ON public.field_values;
DROP TRIGGER IF EXISTS validate_field_definition ON public.field_definitions;
DROP TRIGGER IF EXISTS set_field_definitions_updated_at ON public.field_definitions;

DROP FUNCTION IF EXISTS private.validate_field_value();
DROP FUNCTION IF EXISTS private.validate_field_definition();

-- field_values first: it holds the FK to field_definitions.
DROP TABLE IF EXISTS public.field_values;
DROP TABLE IF EXISTS public.field_definitions;

DO $$
DECLARE
  v_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('field_values', 'field_definitions')
  ) THEN
    RAISE EXCEPTION 'A custom-field table survived the revert. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  RAISE NOTICE '114 reverted: custom fields removed, % tasks intact.', v_count;

  DELETE FROM public.applied_migrations WHERE filename = '114_custom_fields.sql';
END $$;

COMMIT;
