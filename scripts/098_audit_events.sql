-- Audit events for membership, role and configuration changes (PROMPT B).
--
-- The app already records what happens to *work* (`task_activity`, migration 052). Nothing
-- recorded what happens to *access*: who was added to a board, who was made a guest, whose
-- platform role changed, which module was switched off. Those are exactly the changes you
-- need a history of when something looks wrong later, and they were invisible.
--
-- ── Why triggers rather than app code ────────────────────────────────────────────────
-- A client that has to remember to write an audit row is a client that will eventually
-- forget, and the rows written by psql, the Supabase dashboard, or a future script would be
-- missing entirely. A trigger cannot be bypassed by any caller, which is the only property
-- that makes an audit log worth reading.
--
-- ── Why no foreign keys on actor_id / subject_id ─────────────────────────────────────
-- Deliberate, and load-bearing in two ways:
--   1. An audit record must outlive its subject. "Who removed this person's access?" is
--      most interesting precisely when that person no longer exists.
--   2. An FK would make deletion order matter. Deleting a profile cascades into
--      board_members, firing this trigger; if the audit insert referenced a profile row the
--      cascade had already removed, the FK would abort the whole delete. An audit log that
--      can block the operation it is observing is worse than no audit log.
-- Display names are therefore resolved and frozen into `summary` at write time.
--
-- ── Cascade noise ────────────────────────────────────────────────────────────────────
-- Deleting a board cascade-deletes its membership rows. Logging "Alice was removed from
-- Roadmap" for every member is false: nobody removed them, the board went away. The DELETE
-- triggers therefore skip rows whose container or subject no longer exists — inside the same
-- transaction the parent is already gone, so this is a reliable test for "this deletion was
-- debris, not a decision".
--
-- Append-only by construction: `authenticated` gets SELECT and nothing else, and there are no
-- INSERT/UPDATE/DELETE policies at all, so the SECURITY DEFINER trigger is the only writer.
-- Reading is admin-only, matching `audit.view` in lib/capabilities.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Who performed the change. NULL for anything done by the service role or raw SQL,
  -- which the UI renders as "System" rather than pretending it knows.
  actor_id UUID,
  -- Machine-readable verb, e.g. 'board_member.role_changed'. Stable; the UI groups on it.
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  -- The person the change was ABOUT, when there is one.
  subject_id UUID,
  -- User-facing sentence, resolved at write time. Deliberately free of security internals:
  -- no policy names, no function names, no table names, no raw ids.
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- The log is always read newest-first, and almost always filtered by nothing else.
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON public.audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON public.audit_events (entity_type, entity_id);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant every new table in `public` a blanket ALL to anon and
-- authenticated. 095 narrowed the defaults, but the REVOKE stays explicit: it is the property
-- being asserted, not an assumption about what ran before.
REVOKE ALL ON public.audit_events FROM PUBLIC;
REVOKE ALL ON public.audit_events FROM anon;
REVOKE ALL ON public.audit_events FROM authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

DROP POLICY IF EXISTS "Admins can read audit events" ON public.audit_events;
CREATE POLICY "Admins can read audit events" ON public.audit_events FOR SELECT
  TO authenticated
  -- is_admin_user() is true for admin AND super_admin (047). Writing role = 'admin' here
  -- would exclude the two super_admins, which is the trap that made marketing column
  -- reordering silently fail for exactly the people who needed it.
  USING (private.is_admin_user());

-- ── Helpers ──────────────────────────────────────────────────────────────────────────

-- Display name frozen into the summary. Returns a neutral placeholder rather than NULL so a
-- summary can never read "  was given access".
CREATE OR REPLACE FUNCTION private.audit_person_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.email) FROM public.profiles p WHERE p.id = p_user_id),
    'A removed user'
  );
$$;

CREATE OR REPLACE FUNCTION private.record_audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_subject_id  uuid,
  p_summary     text,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, subject_id, summary, metadata)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_subject_id, p_summary, p_metadata);
$$;

REVOKE ALL ON FUNCTION private.audit_person_name(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.record_audit_event(text, text, uuid, uuid, text, jsonb) FROM PUBLIC;

-- ── board_members ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.audit_board_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board_title text;
  v_person      text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT b.title INTO v_board_title FROM public.boards b WHERE b.id = NEW.board_id;
    v_person := private.audit_person_name(NEW.user_id);
    PERFORM private.record_audit_event(
      'board_member.added', 'board', NEW.board_id, NEW.user_id,
      format('%s was given %s access to %s.', v_person,
             CASE NEW.role WHEN 'member' THEN 'full' ELSE NEW.role END,
             COALESCE(v_board_title, 'a board')),
      jsonb_build_object('role', NEW.role, 'board_title', v_board_title)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only a role change is worth an event; touching created_at is not.
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    SELECT b.title INTO v_board_title FROM public.boards b WHERE b.id = NEW.board_id;
    v_person := private.audit_person_name(NEW.user_id);
    PERFORM private.record_audit_event(
      'board_member.role_changed', 'board', NEW.board_id, NEW.user_id,
      format('%s''s access to %s changed from %s to %s.', v_person,
             COALESCE(v_board_title, 'a board'), OLD.role, NEW.role),
      jsonb_build_object('from', OLD.role, 'to', NEW.role, 'board_title', v_board_title)
    );
    RETURN NEW;
  END IF;

  -- DELETE. Skip cascade debris: if the board or the person is already gone, this row was
  -- removed by that deletion rather than by anyone's decision about access.
  IF NOT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = OLD.board_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  SELECT b.title INTO v_board_title FROM public.boards b WHERE b.id = OLD.board_id;
  PERFORM private.record_audit_event(
    'board_member.removed', 'board', OLD.board_id, OLD.user_id,
    format('%s no longer has access to %s.', private.audit_person_name(OLD.user_id),
           COALESCE(v_board_title, 'a board')),
    jsonb_build_object('role', OLD.role, 'board_title', v_board_title)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_board_members ON public.board_members;
CREATE TRIGGER trg_audit_board_members
  AFTER INSERT OR UPDATE OR DELETE ON public.board_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_board_members();

-- ── team_members ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.audit_team_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.name INTO v_team_name FROM public.teams t WHERE t.id = NEW.team_id;
    PERFORM private.record_audit_event(
      'team_member.added', 'team', NEW.team_id, NEW.user_id,
      format('%s joined %s.', private.audit_person_name(NEW.user_id), COALESCE(v_team_name, 'a team')),
      jsonb_build_object('team_name', v_team_name)
    );
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = OLD.team_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  SELECT t.name INTO v_team_name FROM public.teams t WHERE t.id = OLD.team_id;
  PERFORM private.record_audit_event(
    'team_member.removed', 'team', OLD.team_id, OLD.user_id,
    format('%s left %s.', private.audit_person_name(OLD.user_id), COALESCE(v_team_name, 'a team')),
    jsonb_build_object('team_name', v_team_name)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_team_members ON public.team_members;
CREATE TRIGGER trg_audit_team_members
  AFTER INSERT OR DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_team_members();

-- ── marketing_calendar_members ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.audit_calendar_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.name INTO v_name FROM public.marketing_calendars c WHERE c.id = NEW.calendar_id;
    PERFORM private.record_audit_event(
      'calendar_member.added', 'marketing_calendar', NEW.calendar_id, NEW.user_id,
      format('%s was given access to %s.', private.audit_person_name(NEW.user_id),
             COALESCE(v_name, 'a marketing calendar')),
      jsonb_build_object('calendar_name', v_name)
    );
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketing_calendars c WHERE c.id = OLD.calendar_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  SELECT c.name INTO v_name FROM public.marketing_calendars c WHERE c.id = OLD.calendar_id;
  PERFORM private.record_audit_event(
    'calendar_member.removed', 'marketing_calendar', OLD.calendar_id, OLD.user_id,
    format('%s no longer has access to %s.', private.audit_person_name(OLD.user_id),
           COALESCE(v_name, 'a marketing calendar')),
    jsonb_build_object('calendar_name', v_name)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_calendar_members ON public.marketing_calendar_members;
CREATE TRIGGER trg_audit_calendar_members
  AFTER INSERT OR DELETE ON public.marketing_calendar_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_calendar_members();

-- ── profiles.role ────────────────────────────────────────────────────────────────────
-- Only the platform role. Profiles are updated constantly (names, notification prefs, the
-- last-seen timestamp); auditing all of it would bury the one field that grants power.

CREATE OR REPLACE FUNCTION private.audit_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;

  PERFORM private.record_audit_event(
    'profile.role_changed', 'profile', NEW.id, NEW.id,
    format('%s''s account role changed from %s to %s.',
           private.audit_person_name(NEW.id),
           COALESCE(OLD.role, 'none'), COALESCE(NEW.role, 'none')),
    jsonb_build_object('from', OLD.role, 'to', NEW.role)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_role ON public.profiles;
CREATE TRIGGER trg_audit_profile_role
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_profile_role();

-- ── app_modules ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.audit_app_modules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN RETURN NEW; END IF;

  PERFORM private.record_audit_event(
    'module.toggled', 'module', NULL, NULL,
    format('The %s module was turned %s.',
           replace(NEW.module_key, '_', ' '),
           CASE WHEN NEW.enabled THEN 'on' ELSE 'off' END),
    jsonb_build_object('module_key', NEW.module_key, 'enabled', NEW.enabled)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_app_modules ON public.app_modules;
CREATE TRIGGER trg_audit_app_modules
  AFTER UPDATE OF enabled ON public.app_modules
  FOR EACH ROW EXECUTE FUNCTION private.audit_app_modules();

-- ── Post-conditions ──────────────────────────────────────────────────────────────────
-- Assert inside the transaction so a partial apply rolls back rather than leaving a
-- half-wired audit trail, which would be worse than none (it would look complete).

DO $$
DECLARE
  v_triggers int;
  v_policies int;
  v_anon     int;
BEGIN
  SELECT count(*) INTO v_triggers
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN ('trg_audit_board_members', 'trg_audit_team_members',
                   'trg_audit_calendar_members', 'trg_audit_profile_role',
                   'trg_audit_app_modules');
  IF v_triggers <> 5 THEN
    RAISE EXCEPTION 'expected 5 audit triggers, found %', v_triggers;
  END IF;

  -- Exactly one policy, and it must be SELECT. An INSERT/UPDATE/DELETE policy appearing
  -- here later would silently make the log forgeable.
  SELECT count(*) INTO v_policies FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'audit_events';
  IF v_policies <> 1 THEN
    RAISE EXCEPTION 'audit_events should have exactly 1 (SELECT) policy, found %', v_policies;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_events' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'audit_events is missing its SELECT policy';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_events'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on audit_events';
  END IF;

  SELECT count(*) INTO v_anon
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'audit_events' AND grantee IN ('anon', 'PUBLIC');
  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on audit_events', v_anon;
  END IF;

  -- authenticated must hold SELECT and nothing more; a write grant would let a client
  -- fabricate history even with no policy, the day someone adds one.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'audit_events'
      AND grantee = 'authenticated' AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated holds a non-SELECT grant on audit_events';
  END IF;
END $$;

COMMIT;
