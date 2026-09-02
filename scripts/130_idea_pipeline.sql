-- 130: the idea pipeline - capture, research, validate, and convert into real work.
--
-- WHY THIS EXISTS
-- Prompt H asks for a pipeline whose states are OPTIONAL and whose research survives:
-- "Validated ideas may convert to project / feature / work item. Preserve research/history."
-- The second sentence is the hard part. Converting an idea normally means retyping it into a
-- task and losing every reason it was worth doing - the evidence, the expected value, who
-- doubted it. So conversion here writes a POINTER and an EVENT, never a move: the idea row
-- stays exactly where it is, keeps its research, and gains a link to what it became.
--
-- WHY THREE TABLES AND NOT ONE
-- Two different things want to live in an idea's history and they have opposite trust models.
--   `idea_events` is the RECORD OF WHAT HAPPENED - state changes and conversions. It is
--   trigger-written and `authenticated` holds SELECT and nothing else, the same guarantee as
--   crm_order_status_history (103), recurrence_occurrences (116), sprint_metrics (124) and
--   goal_checkins (129). An idea that was rejected in March cannot be made to look as though
--   it was never considered.
--   `idea_notes` is RESEARCH PEOPLE WRITE. It has to be editable by its author, because that
--   is what a note is. Folding the two together would mean either a forgeable transition log
--   or an uneditable note, and both are worse than one extra table.
--
-- ⚠️ REJECTING AN IDEA NEEDS A REASON, and it is enforced by a trigger rather than by the
-- dialog - 128's rule for owner decisions, and 104's for crm_statuses.requires_reason, which
-- was honoured by one screen and by nothing underneath it. Six months on, the reason is the
-- only thing standing between the team and re-proposing the same idea. `state_note` is the
-- write-only carrier that delivers it, and 104's lesson applies in full: no `OF column`
-- clause, and every path out of the trigger blanks the carrier.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: three NEW tables and triggers on NEW TABLES ONLY. No existing table, row, policy,
-- grant or trigger is touched, and it seeds nothing. Eligible on this repo's own rule.
-- It depends on 129 only for the `strategy` app_modules row, which 129 already seeded off.
-- Rollback: scripts/rollback/130_revert.sql (destroys every idea, note and event).

BEGIN;

CREATE TEMP TABLE _130_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.boards)      AS board_rows,
  (SELECT count(*) FROM public.tasks)       AS task_rows,
  (SELECT count(*) FROM public.app_modules) AS module_rows;

-- ---------------------------------------------------------------------------------------
-- 1. The idea.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ideas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),

  -- Prompt H's field list, every one of them optional. An idea you can only capture after
  -- filling in six boxes is an idea that does not get captured - the progressive-disclosure
  -- principle, which is why `title` is the only NOT NULL in this table.
  problem         TEXT CHECK (problem         IS NULL OR length(problem)         <= 4000),
  target_customer TEXT CHECK (target_customer IS NULL OR length(target_customer) <= 2000),
  evidence        TEXT CHECK (evidence        IS NULL OR length(evidence)        <= 4000),
  expected_value  TEXT CHECK (expected_value  IS NULL OR length(expected_value)  <= 4000),

  -- The three scales that make an impact/effort view possible. Deliberately words, not
  -- numbers: a 1-10 impact score reads as a measurement and is a guess, and averaging guesses
  -- is how a portfolio ends up ranked by false precision.
  impact          TEXT CHECK (impact     IS NULL OR impact     IN ('high', 'medium', 'low')),
  effort          TEXT CHECK (effort     IS NULL OR effort     IN ('high', 'medium', 'low')),
  confidence      TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),

  -- Prompt H's seven states, in order. `rejected` and `archived` are different endings on
  -- purpose: rejected is a decision with a reason attached, archived is "not now, not a no".
  state           TEXT NOT NULL DEFAULT 'captured'
                  CHECK (state IN ('captured', 'reviewing', 'researching', 'validated', 'planned', 'rejected', 'archived')),

  -- What it became. SET NULL rather than CASCADE, plus a separate `converted_at`: deleting
  -- the board an idea turned into must not delete the idea, and it must not make a converted
  -- idea look as though it was never acted on either. The timestamp is the durable fact; the
  -- pointers are a convenience that may legitimately go stale.
  converted_board_id UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  converted_task_id  UUID REFERENCES public.tasks(id)  ON DELETE SET NULL,
  converted_at       TIMESTAMPTZ,

  -- ⚠️ WRITE-ONLY CARRIER (103/104/129's pattern), always NULL at rest.
  state_note      TEXT CHECK (state_note IS NULL OR length(state_note) <= 2000),

  position        INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ideas_state ON public.ideas(state, position);

COMMENT ON TABLE public.ideas IS
  'Something somebody thinks is worth doing, before it is work. Converting one creates a '
  'board or a task and records a pointer here - the idea itself never moves, so the reasoning '
  'behind a piece of work survives the moment it becomes a ticket.';

COMMENT ON COLUMN public.ideas.converted_at IS
  'When this idea became real work. Kept separately from the two pointers because those are '
  'ON DELETE SET NULL: deleting the board must not make a converted idea look untouched.';

-- ---------------------------------------------------------------------------------------
-- 2. What happened to it. TRIGGER-WRITTEN ONLY.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.idea_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id    UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('captured', 'state_change', 'converted')),
  from_state TEXT,
  to_state   TEXT,
  note       TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idea_events_idea ON public.idea_events(idea_id, created_at);

COMMENT ON TABLE public.idea_events IS
  'The immutable record of an idea moving through the pipeline. Written by a trigger and by '
  'nothing else; authenticated holds SELECT only. This is what makes "we already looked at '
  'this and here is why we said no" answerable a year later.';

-- ---------------------------------------------------------------------------------------
-- 3. Research people write. Editable, because that is what a note is.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.idea_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id    UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  -- SET NULL, not CASCADE: deprovisioning somebody must not delete the research everybody
  -- else relied on. 100/119's rule, asked at creation this time rather than two days later.
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idea_notes_idea ON public.idea_notes(idea_id, created_at);

COMMENT ON TABLE public.idea_notes IS
  'Research and discussion attached to an idea. created_by is ON DELETE SET NULL so a '
  'departing colleague takes their attribution and not the team''s evidence.';

-- ---------------------------------------------------------------------------------------
-- 4. Triggers. NEW TABLES ONLY.
-- ---------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS touch_ideas ON public.ideas;
CREATE TRIGGER touch_ideas
  BEFORE UPDATE ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS touch_idea_notes ON public.idea_notes;
CREATE TRIGGER touch_idea_notes
  BEFORE UPDATE ON public.idea_notes
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

/**
 * The pipeline's rules, and the carrier that carries a reason into the ledger.
 *
 * ⚠️ NO `OF column` CLAUSE (104). An UPDATE that sets only `state_note` must still be seen,
 * or the value is simply stored and the NEXT state change stamps a sentence nobody supplied
 * onto the record of a decision. That is not a hypothetical: it happened on crm_orders, was
 * observed on dev, and is the single most expensive bug this schema has produced.
 */
CREATE OR REPLACE FUNCTION private.enforce_idea_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note TEXT;
BEGIN
  v_note := NULLIF(btrim(COALESCE(NEW.state_note, '')), '');
  -- Blank FIRST, decide second. Every path below returns, and none of them may leave the
  -- carrier behind.
  NEW.state_note := NULL;

  IF TG_OP = 'INSERT' THEN
    -- A note at creation would have no transition to describe and no ledger row to land on.
    IF v_note IS NOT NULL THEN
      RAISE EXCEPTION 'A note explains a change of state. Capture the idea first, then move it.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Conversion pointers are set by moving the idea to `planned`, never at birth.
    IF NEW.converted_board_id IS NOT NULL OR NEW.converted_task_id IS NOT NULL OR NEW.converted_at IS NOT NULL THEN
      RAISE EXCEPTION 'An idea cannot be created already converted. Capture it, then convert it.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from here down.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    -- Prompt H does not prescribe a strict order and deliberately calls the states optional,
    -- so an idea may skip straight from captured to validated. The one rule is that a NO has
    -- to say why - 128's rule for a closed decision, for the same reason.
    IF NEW.state = 'rejected' AND v_note IS NULL THEN
      RAISE EXCEPTION 'Rejecting an idea needs a reason. In six months it is the only thing that stops this being proposed again.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_note IS NOT NULL THEN
    -- Refused rather than dropped: the caller asked to record something. Research that is
    -- not a state change belongs in idea_notes, and the message says so.
    RAISE EXCEPTION 'A state note has to accompany a change of state. Add research as a note on the idea instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- `converted_at` is stamped here, never supplied, so the record cannot claim an idea became
  -- work at a time it did not. Clearing both pointers clears it again, which is how an
  -- accidental conversion is undone.
  IF (NEW.converted_board_id IS NOT NULL OR NEW.converted_task_id IS NOT NULL) THEN
    NEW.converted_at := COALESCE(OLD.converted_at, now());
  ELSE
    NEW.converted_at := NULL;
  END IF;

  -- ⚠️ THE LEDGER IS WRITTEN HERE, IN THE **BEFORE** TRIGGER, and that is not a style choice.
  -- The first version of this migration wrote it from an AFTER trigger reading OLD.state_note,
  -- which is ALWAYS NULL - the carrier's whole contract is that it never comes to rest, so the
  -- pre-update row can never be holding it. Every rejection reached the history with no reason
  -- attached, silently, and check-strategy.mjs is what caught it rather than review. The row
  -- exists on an UPDATE, so the foreign key is satisfied and 129's goal ledger does the same.
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.idea_events (idea_id, kind, from_state, to_state, note, created_by)
    VALUES (NEW.id, 'state_change', OLD.state, NEW.state, v_note, auth.uid());
  END IF;

  IF NEW.converted_at IS NOT NULL AND OLD.converted_at IS NULL THEN
    INSERT INTO public.idea_events (idea_id, kind, from_state, to_state, note, created_by)
    VALUES (
      NEW.id, 'converted', OLD.state, NEW.state,
      CASE
        WHEN NEW.converted_board_id IS NOT NULL AND NEW.converted_task_id IS NOT NULL THEN 'Became a project and a work item.'
        WHEN NEW.converted_board_id IS NOT NULL THEN 'Became a project.'
        ELSE 'Became a work item.'
      END,
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_idea_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_idea_state ON public.ideas;
CREATE TRIGGER enforce_idea_state
  BEFORE INSERT OR UPDATE ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION private.enforce_idea_state();

/**
 * The one event that CANNOT be written by the BEFORE trigger.
 *
 * On INSERT the idea does not exist yet, so idea_events.idea_id's foreign key would refuse the
 * row - 103's three-trigger lesson. Everything else lives in enforce_idea_state above, where
 * the write-only carrier is still readable; see the warning there for what happened when it
 * did not.
 */
CREATE OR REPLACE FUNCTION private.record_idea_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.idea_events (idea_id, kind, from_state, to_state, created_by)
  VALUES (NEW.id, 'captured', NULL, NEW.state, COALESCE(auth.uid(), NEW.created_by));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_idea_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_idea_event ON public.ideas;
CREATE TRIGGER record_idea_event
  AFTER INSERT ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION private.record_idea_event();

-- ---------------------------------------------------------------------------------------
-- 5. Grants. REVOKE first - Supabase default-grants ALL on every new public table (095).
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.ideas       FROM anon, authenticated;
REVOKE ALL ON public.idea_events FROM anon, authenticated;
REVOKE ALL ON public.idea_notes  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ideas      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idea_notes TO authenticated;
-- SELECT and nothing else. The pipeline's memory is not application-writable.
GRANT SELECT ON public.idea_events TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. RLS.
--
-- ⚠️ Ideas are workspace-wide and readable by everyone signed in, deliberately. An idea box
-- only half the company can see collects half the ideas. The residual is stated rather than
-- hidden: `converted_board_id` may name a PRIVATE board, so a reader who is not a member
-- learns that some board exists - an id, never content, and exactly the residual 119 accepted
-- for a global shared view. The UI resolves board titles through the caller's own `boards`
-- query, so an unreadable one renders as "a project you cannot see" rather than leaking a name.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.ideas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_notes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone signed in reads ideas" ON public.ideas;
CREATE POLICY "Everyone signed in reads ideas" ON public.ideas
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Anyone active may capture one. This is the one table in the module where a wide write
-- policy is the point: an idea pipeline gated to admins is a suggestion box with a lock on it.
DROP POLICY IF EXISTS "Anyone active captures an idea" ON public.ideas;
CREATE POLICY "Anyone active captures an idea" ON public.ideas
  FOR INSERT WITH CHECK (private.is_active_user());

-- Moving an idea through the pipeline is a judgement about the company's direction, so it is
-- admin - or the person who raised it, who may keep editing and withdraw their own.
DROP POLICY IF EXISTS "Admins and the author move an idea" ON public.ideas;
CREATE POLICY "Admins and the author move an idea" ON public.ideas
  FOR UPDATE
  USING (private.is_active_user() AND (private.is_admin_user() OR created_by = auth.uid()))
  WITH CHECK (private.is_active_user() AND (private.is_admin_user() OR created_by = auth.uid()));

DROP POLICY IF EXISTS "Admins and the author delete an idea" ON public.ideas;
CREATE POLICY "Admins and the author delete an idea" ON public.ideas
  FOR DELETE USING (private.is_active_user() AND (private.is_admin_user() OR created_by = auth.uid()));

DROP POLICY IF EXISTS "Everyone signed in reads idea history" ON public.idea_events;
CREATE POLICY "Everyone signed in reads idea history" ON public.idea_events
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Everyone signed in reads idea notes" ON public.idea_notes;
CREATE POLICY "Everyone signed in reads idea notes" ON public.idea_notes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Anyone active writes research" ON public.idea_notes;
CREATE POLICY "Anyone active writes research" ON public.idea_notes
  FOR INSERT WITH CHECK (
    private.is_active_user()
    AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.ideas i WHERE i.id = idea_notes.idea_id)
  );

-- Only the author edits their own words. An admin may remove a note but not rewrite it -
-- editing somebody else's research and leaving their name on it is worse than deleting it.
DROP POLICY IF EXISTS "The author edits their own research" ON public.idea_notes;
CREATE POLICY "The author edits their own research" ON public.idea_notes
  FOR UPDATE
  USING (private.is_active_user() AND created_by = auth.uid())
  WITH CHECK (private.is_active_user() AND created_by = auth.uid());

DROP POLICY IF EXISTS "The author or an admin removes research" ON public.idea_notes;
CREATE POLICY "The author or an admin removes research" ON public.idea_notes
  FOR DELETE USING (private.is_active_user() AND (private.is_admin_user() OR created_by = auth.uid()));

-- ---------------------------------------------------------------------------------------
-- 7. Post-conditions - trying the bad write, not describing it (117).
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_boards  BIGINT;
  v_tasks   BIGINT;
  v_modules BIGINT;
  v_idea    UUID;
  v_refused BOOLEAN;
BEGIN
  SELECT board_rows, task_rows, module_rows INTO v_boards, v_tasks, v_modules FROM _130_precheck;

  IF (SELECT count(*) FROM public.boards) <> v_boards THEN RAISE EXCEPTION 'Board rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.tasks)  <> v_tasks  THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.app_modules) <> v_modules THEN
    RAISE EXCEPTION 'app_modules changed. 130 must seed no module - 129 already did. Aborting.';
  END IF;

  IF (SELECT count(*) FROM public.ideas) <> 0 THEN RAISE EXCEPTION 'ideas seeded rows. Aborting.'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('ideas', 'idea_events', 'idea_notes')
       AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on every new idea table. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name IN ('ideas', 'idea_events', 'idea_notes')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on an idea table. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'idea_events'
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated can write idea_events. The pipeline history would be forgeable. Aborting.';
  END IF;

  -- ---- Behaviour.
  INSERT INTO public.ideas (title, problem, impact, effort) VALUES ('_130 self-test', 'p', 'high', 'low')
  RETURNING id INTO v_idea;

  IF (SELECT count(*) FROM public.idea_events WHERE idea_id = v_idea AND kind = 'captured') <> 1 THEN
    RAISE EXCEPTION 'Capturing an idea did not open its history. Aborting.';
  END IF;

  UPDATE public.ideas SET state = 'researching' WHERE id = v_idea;
  IF (SELECT count(*) FROM public.idea_events WHERE idea_id = v_idea AND kind = 'state_change') <> 1 THEN
    RAISE EXCEPTION 'A state change was not recorded. Aborting.';
  END IF;
  IF (SELECT state_note FROM public.ideas WHERE id = v_idea) IS NOT NULL THEN
    RAISE EXCEPTION 'state_note is not NULL at rest. Aborting.';
  END IF;

  -- A rejection with no reason must be refused. This is the rule the whole carrier exists for.
  v_refused := false;
  BEGIN
    UPDATE public.ideas SET state = 'rejected' WHERE id = v_idea;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'An idea was rejected with no reason. Aborting.'; END IF;

  UPDATE public.ideas SET state = 'rejected', state_note = 'Already covered by an existing project.' WHERE id = v_idea;
  -- ⚠️ Asserted by VALUE, not by row count. The first version of this migration recorded the
  -- transition with note = NULL and this check is what would have caught it, had it existed:
  -- "a state change was recorded" was true and useless.
  IF (SELECT note FROM public.idea_events WHERE idea_id = v_idea AND to_state = 'rejected')
     IS DISTINCT FROM 'Already covered by an existing project.' THEN
    RAISE EXCEPTION 'The rejection reason did not reach the history. Aborting.';
  END IF;
  IF (SELECT state_note FROM public.ideas WHERE id = v_idea) IS NOT NULL THEN
    RAISE EXCEPTION 'The carrier survived a rejection. 104 all over again. Aborting.';
  END IF;

  -- A note with no state change is refused, and does not come to rest either.
  v_refused := false;
  BEGIN
    UPDATE public.ideas SET state_note = 'drive-by' WHERE id = v_idea;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'A state note with no state change was accepted. Aborting.'; END IF;
  IF (SELECT state_note FROM public.ideas WHERE id = v_idea) IS NOT NULL THEN
    RAISE EXCEPTION 'A refused note was stored on the idea. Aborting.';
  END IF;

  -- Born converted is refused.
  v_refused := false;
  BEGIN
    INSERT INTO public.ideas (title, converted_at) VALUES ('_130 born converted', now());
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'An idea was created already converted. Aborting.'; END IF;

  DELETE FROM public.ideas WHERE id = v_idea;
  IF (SELECT count(*) FROM public.idea_events WHERE idea_id = v_idea) <> 0 THEN
    RAISE EXCEPTION 'Deleting an idea left its history behind. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.ideas) <> 0 THEN RAISE EXCEPTION 'Self-test ideas survived. Aborting.'; END IF;

  RAISE NOTICE '130 OK: idea pipeline installed, history is trigger-only, a rejection needs a reason.';
END;
$$;

COMMIT;
