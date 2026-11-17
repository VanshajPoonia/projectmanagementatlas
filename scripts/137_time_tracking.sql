-- 137: the optional `time_tracking` module. A start/stop timer in the topbar that logs hours.
--
-- One table of entries, private to the person who logged them, like personal_tasks and
-- user_favorites. A row with no ended_at is the running timer; the partial unique index keeps
-- it to one per person, so a double click cannot start two.
--
-- Purely additive: one new table, one app_modules row seeded OFF. Eligible on this repo's rule.
-- Rollback: scripts/rollback/137_revert.sql

BEGIN;

DROP TABLE IF EXISTS _137_precheck;
CREATE TEMP TABLE _137_precheck AS
SELECT
  (SELECT count(*) FROM public.app_modules) AS module_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

CREATE TABLE IF NOT EXISTS public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT time_entries_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT time_entries_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_running
  ON public.time_entries (user_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_user_started
  ON public.time_entries (user_id, started_at DESC);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.time_entries FROM PUBLIC;
REVOKE ALL ON public.time_entries FROM anon;
REVOKE ALL ON public.time_entries FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;

-- Own rows only. No admin exemption: hours are personal until someone decides otherwise.
DROP POLICY IF EXISTS "Users read their own time entries" ON public.time_entries;
CREATE POLICY "Users read their own time entries"
  ON public.time_entries FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users add their own time entries" ON public.time_entries;
CREATE POLICY "Users add their own time entries"
  ON public.time_entries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users edit their own time entries" ON public.time_entries;
CREATE POLICY "Users edit their own time entries"
  ON public.time_entries FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users remove their own time entries" ON public.time_entries;
CREATE POLICY "Users remove their own time entries"
  ON public.time_entries FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.time_entries IS
  'Start/stop timer entries from the topbar. Private to the owner. ended_at NULL = running.';

INSERT INTO public.app_modules (module_key, enabled)
VALUES ('time_tracking', false)
ON CONFLICT (module_key) DO NOTHING;

DO $post$
DECLARE
  v_before_modules  BIGINT;
  v_before_policies BIGINT;
  v_count           BIGINT;
  v_rls             BOOLEAN;
BEGIN
  SELECT module_rows, policy_rows INTO v_before_modules, v_before_policies FROM _137_precheck;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.time_entries'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '137: RLS must be enabled on time_entries';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'time_entries';
  IF v_count <> 4 THEN
    RAISE EXCEPTION '137: expected 4 policies on time_entries, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies + 4 THEN
    RAISE EXCEPTION '137: policy count went % -> %, expected exactly 4 new', v_before_policies, v_count;
  END IF;

  IF has_table_privilege('anon', 'public.time_entries', 'SELECT')
     OR has_table_privilege('anon', 'public.time_entries', 'INSERT') THEN
    RAISE EXCEPTION '137: anon must hold nothing on time_entries';
  END IF;
  IF has_table_privilege('authenticated', 'public.time_entries', 'TRUNCATE') THEN
    RAISE EXCEPTION '137: authenticated must not hold TRUNCATE';
  END IF;

  SELECT count(*) INTO v_count FROM public.app_modules;
  IF v_count IS DISTINCT FROM v_before_modules + 1 THEN
    RAISE EXCEPTION '137: expected one new module row, went % -> %', v_before_modules, v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_modules WHERE module_key = 'time_tracking' AND enabled = false
  ) THEN
    RAISE EXCEPTION '137: time_tracking must ship switched off';
  END IF;

  RAISE NOTICE '137 verified: time_entries ready, owner-only RLS, module seeded OFF.';
END
$post$;

COMMIT;
