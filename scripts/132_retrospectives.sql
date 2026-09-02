-- 132: retrospectives - templates, grouping, voting, follow-up actions, and anonymity that
--      is actually enforced by the database rather than by the screen.
--
-- WHY THE ANONYMITY DESIGN LOOKS LIKE THIS
-- Prompt H's whole sentence on the subject is a condition: "If anonymous mode is added,
-- enforce anonymity server-side." A boolean that only stops the UI printing a name is the
-- crm_statuses.requires_reason defect (104) pointed at the one feature where being wrong is
-- unrecoverable - a person cannot un-say the thing they said believing nobody would know.
--
-- So the author of an anonymous note is not stored anywhere the client can read:
--   * `retro_notes.author_id` is set by a trigger, and is NULL when the retro is anonymous.
--     A client cannot set it and cannot change it.
--   * The REAL author goes in `retro_note_authors`, which `authenticated` holds NO privilege
--     on whatsoever - not SELECT, not anything. Not a revoked column on a readable table
--     (which a later GRANT could quietly re-expose), a separate table with nothing granted,
--     which is the same shape as recurrence_occurrences (116) and goal_checkins (129) turned
--     inside out. The post-conditions assert the emptiness of that grant, because 095's
--     lesson is that Supabase hands every new table a blanket ALL and narrow granting is
--     not enough on its own.
--   * Editing and deleting your own anonymous note still works, through
--     `private.is_retro_note_author()` - a SECURITY DEFINER helper the POLICY calls. The
--     client never learns the answer for anybody else's note.
--   * Finding your own notes on screen goes through `public.my_retro_note_ids(retro)`, which
--     returns only the caller's own ids. That is the documented answer in this codebase to
--     "hidden from you and does not exist arrive looking identical" - a definer function that
--     resolves past RLS and returns the NARROWEST possible result (122's notify_task_watchers).
--   * `retro_votes` is readable only by its own owner, so "who voted for this" is never
--     answerable by anyone. The public number lives in `retro_notes.vote_count`, maintained by
--     a trigger, and `authenticated` has no UPDATE privilege on that column at all.
--
-- ⚠️ THE HONEST RESIDUAL, stated rather than hidden: this protects the STORED record. Someone
-- watching the board live can still infer who typed what from the order notes appear in. That
-- is inherent to a real-time retro and no schema fixes it; the guide says so in plain words
-- rather than letting people over-trust the feature.
--
-- ⚠️ `is_anonymous` IS IMMUTABLE after creation. Flipping an anonymous retro to named would
-- retroactively expose people who wrote under the opposite promise, and there is no undo for
-- that. The trigger refuses the change in both directions, because a retro that changes its
-- rules mid-session is one nobody can reason about.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: six NEW tables, two new functions, triggers on NEW TABLES ONLY. No existing table,
-- row, policy, grant or trigger is touched and nothing is seeded. Eligible on this repo's own
-- rule. Depends on 123 for the optional `sprint_id` link.
-- Rollback: scripts/rollback/132_revert.sql (destroys every retrospective and its contents).

BEGIN;

CREATE TEMP TABLE _132_precheck ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.boards) AS board_rows,
       (SELECT count(*) FROM public.tasks)  AS task_rows,
       (SELECT count(*) FROM public.app_modules) AS module_rows;

-- ---------------------------------------------------------------------------------------
-- 1. The retrospective.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retrospectives (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id     UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  -- Optional. A retro usually follows a delivery window, but agile is off on most boards and
  -- a retro must not require it. SET NULL: deleting a sprint must not delete what was learned.
  sprint_id    UUID REFERENCES public.sprints(id) ON DELETE SET NULL,
  title        TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- "Simple templates", per the prompt. The template decides which columns exist; the map
  -- lives in private.retro_template_columns() so the database, not the screen, is the
  -- authority on where a note may be filed.
  template     TEXT NOT NULL DEFAULT 'what_went_well'
               CHECK (template IN ('what_went_well', 'start_stop_continue', 'four_ls', 'plain')),
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  -- open: people are still adding and voting. closed: the record of what was said.
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  held_on      DATE,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retrospectives_board ON public.retrospectives(board_id, created_at DESC);

COMMENT ON COLUMN public.retrospectives.is_anonymous IS
  'Immutable after creation, enforced by a trigger. Flipping it would retroactively expose or '
  'conceal people who wrote under the opposite promise, and there is no undo for the first.';

-- ---------------------------------------------------------------------------------------
-- 2. Grouping. A theme people drag related notes onto.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retro_note_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retro_id   UUID NOT NULL REFERENCES public.retrospectives(id) ON DELETE CASCADE,
  title      TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  position   INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retro_groups_retro ON public.retro_note_groups(retro_id, position);

-- ---------------------------------------------------------------------------------------
-- 3. The notes.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retro_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retro_id   UUID NOT NULL REFERENCES public.retrospectives(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  group_id   UUID REFERENCES public.retro_note_groups(id) ON DELETE SET NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  -- ⚠️ NULL on an anonymous retro, ALWAYS. Written by a trigger; `authenticated` holds no
  -- UPDATE privilege on this column, so it cannot be set later either.
  author_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Maintained by the vote trigger. No UPDATE grant on this column - a self-reported score is
  -- not a score.
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retro_notes_retro ON public.retro_notes(retro_id, column_key, position);

COMMENT ON COLUMN public.retro_notes.author_id IS
  'The public author, NULL on an anonymous retrospective. The real author is in '
  'retro_note_authors, which authenticated holds no privilege on at all.';

-- ---------------------------------------------------------------------------------------
-- 4. The anonymity boundary. NO GRANTS TO ANYONE.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retro_note_authors (
  note_id UUID PRIMARY KEY REFERENCES public.retro_notes(id) ON DELETE CASCADE,
  -- CASCADE, not SET NULL: if the person is deprovisioned the link disappears entirely,
  -- which is the correct direction for a privacy record. The NOTE survives - it is the team's
  -- - and simply becomes unowned, which is what anonymous already looks like.
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retro_note_authors_user ON public.retro_note_authors(user_id);

COMMENT ON TABLE public.retro_note_authors IS
  'Who really wrote each retrospective note. authenticated holds NO privilege on this table - '
  'it exists so a person can still edit their own anonymous note without anyone being able to '
  'ask who wrote anybody else''s. Reached only through private.is_retro_note_author() and '
  'public.my_retro_note_ids().';

-- ---------------------------------------------------------------------------------------
-- 5. Voting. One vote per person per note; who voted is private, the count is public.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retro_votes (
  note_id    UUID NOT NULL REFERENCES public.retro_notes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

COMMENT ON TABLE public.retro_votes IS
  'One row per person per note. RLS scopes it to the caller''s OWN votes in every direction, '
  'so "who voted for this" is unanswerable by design - including on a named retro, where '
  'knowing who agreed with a criticism is the same disclosure by another route.';

-- ---------------------------------------------------------------------------------------
-- 6. Follow-up actions, and their conversion into canonical work.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retro_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retro_id     UUID NOT NULL REFERENCES public.retrospectives(id) ON DELETE CASCADE,
  -- Which note it came out of, when it came out of one.
  note_id      UUID REFERENCES public.retro_notes(id) ON DELETE SET NULL,
  body         TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  owner_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date     DATE,
  -- ⚠️ The conversion is a POINTER, never a move. Prompt H: "conversion of actions to
  -- canonical work items" - so the work item is a real `tasks` row that every board, view,
  -- report and My Work section already reads, and the action row stays here holding the
  -- context the task cannot carry. SET NULL plus a separate timestamp, 130's reasoning:
  -- deleting the task must not make a converted action look untouched.
  task_id      UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retro_actions_retro ON public.retro_actions(retro_id, created_at);

-- ---------------------------------------------------------------------------------------
-- 7. The template map. In SQL, because the database has to be the authority on where a note
--    may be filed - a note stored under a column the template does not render is invisible,
--    and "hidden from you" and "does not exist" arriving identical is this repo's most
--    expensive recurring shape. lib/retrospectives.ts mirrors it, and check-strategy.mjs
--    writes EVERY key the TypeScript side declares against the real database plus one bogus
--    key, so the two cannot drift without a harness failing.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.retro_template_columns(p_template TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_template
    WHEN 'what_went_well'      THEN ARRAY['well', 'not_well', 'ideas']
    WHEN 'start_stop_continue' THEN ARRAY['start', 'stop', 'continue']
    WHEN 'four_ls'             THEN ARRAY['liked', 'learned', 'lacked', 'longed_for']
    WHEN 'plain'               THEN ARRAY['notes']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

REVOKE ALL ON FUNCTION private.retro_template_columns(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 8. Triggers. NEW TABLES ONLY.
-- ---------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS touch_retrospectives ON public.retrospectives;
CREATE TRIGGER touch_retrospectives BEFORE UPDATE ON public.retrospectives
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS touch_retro_notes ON public.retro_notes;
CREATE TRIGGER touch_retro_notes BEFORE UPDATE ON public.retro_notes
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS touch_retro_actions ON public.retro_actions;
CREATE TRIGGER touch_retro_actions BEFORE UPDATE ON public.retro_actions
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

/**
 * The retro's own rules: anonymity and template are settled at creation, and a sprint link
 * must point at the same board.
 *
 * ⚠️ NO `OF column` clause (104), and every rule is stated against a DISTINCT FROM comparison
 * rather than a "did the client send this column" test, because PostgREST sends only what
 * changed and a rule that depends on the shape of the request is not a rule.
 */
CREATE OR REPLACE FUNCTION private.enforce_retrospective()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sprint_board UUID;
BEGIN
  IF NEW.sprint_id IS NOT NULL THEN
    SELECT s.board_id INTO v_sprint_board FROM public.sprints s WHERE s.id = NEW.sprint_id;
    IF v_sprint_board IS NULL THEN
      RAISE EXCEPTION 'That delivery window does not exist.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_sprint_board <> NEW.board_id THEN
      RAISE EXCEPTION 'A retrospective can only be linked to a delivery window on its own board.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous THEN
      RAISE EXCEPTION 'Whether a retrospective is anonymous is fixed when it is created. People wrote under the rule that was in force at the time.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The template decides which columns exist, so changing it after notes are filed strands
    -- them under a column nothing renders. An empty retro may still be retemplated.
    IF NEW.template IS DISTINCT FROM OLD.template
       AND EXISTS (SELECT 1 FROM public.retro_notes n WHERE n.retro_id = OLD.id) THEN
      RAISE EXCEPTION 'The template cannot change once notes have been added - they would be filed under columns that no longer exist.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.board_id IS DISTINCT FROM OLD.board_id THEN
      RAISE EXCEPTION 'A retrospective belongs to the board whose work it reviews.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_retrospective() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_retrospective ON public.retrospectives;
CREATE TRIGGER enforce_retrospective
  BEFORE INSERT OR UPDATE ON public.retrospectives
  FOR EACH ROW EXECUTE FUNCTION private.enforce_retrospective();

/**
 * Where the note's authorship is decided. This is the anonymity boundary itself, so it runs
 * BEFORE INSERT (to decide `author_id`) and the private row is written by the AFTER trigger
 * below - 103's timing lesson: the note does not exist yet, so retro_note_authors.note_id's
 * foreign key would refuse the row here.
 */
CREATE OR REPLACE FUNCTION private.enforce_retro_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anon     BOOLEAN;
  v_state    TEXT;
  v_template TEXT;
  v_retro    UUID;
BEGIN
  SELECT r.id, r.is_anonymous, r.state, r.template
    INTO v_retro, v_anon, v_state, v_template
    FROM public.retrospectives r WHERE r.id = NEW.retro_id;

  IF v_retro IS NULL THEN
    RAISE EXCEPTION 'That retrospective does not exist.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT (NEW.column_key = ANY (private.retro_template_columns(v_template))) THEN
    RAISE EXCEPTION 'Column "%" is not part of the % template. A note filed there would never be shown.',
      NEW.column_key, v_template USING ERRCODE = 'check_violation';
  END IF;

  -- A group has to belong to the same retrospective, or grouping silently moves a note into
  -- somebody else's session.
  IF NEW.group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.retro_note_groups g WHERE g.id = NEW.group_id AND g.retro_id = NEW.retro_id
  ) THEN
    RAISE EXCEPTION 'That group belongs to a different retrospective.' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'open' THEN
      RAISE EXCEPTION 'This retrospective is closed. Its notes are the record of what was said.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- ⚠️ The client's value is discarded either way. On an anonymous retro the public author
    -- is NULL; on a named one it is whoever is signed in, never whoever the request claimed.
    NEW.author_id  := CASE WHEN v_anon THEN NULL ELSE auth.uid() END;
    NEW.vote_count := 0;
    RETURN NEW;
  END IF;

  -- UPDATE. Neither of these can be reached through PostgREST anyway (there is no UPDATE
  -- grant on either column), and both are restated here so the rule survives a future grant.
  IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'The author of a retrospective note cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  -- ⚠️ The vote counter has to be able to write this column and nothing else does. A trigger
  -- cannot tell one UPDATE from another, so the permit is a transaction-local GUC naming the
  -- note being recounted - 123's `agile.commitment_stamp` pattern, and it is here for the same
  -- reason: the ledger's own immutability rule would otherwise refuse the one statement that
  -- is allowed to move the number. A client cannot set it (PostgREST executes no arbitrary
  -- SQL and no RPC touches it), and nothing may ride along with it.
  IF NEW.vote_count IS DISTINCT FROM OLD.vote_count THEN
    IF COALESCE(current_setting('retro.vote_recount', true), '') IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'Votes are counted from the votes themselves.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body
       OR NEW.column_key IS DISTINCT FROM OLD.column_key
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.position IS DISTINCT FROM OLD.position THEN
      RAISE EXCEPTION 'Only the vote count may change while votes are being recounted.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.retro_id IS DISTINCT FROM OLD.retro_id THEN
    RAISE EXCEPTION 'A note belongs to the retrospective it was written in.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_retro_note() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_retro_note ON public.retro_notes;
CREATE TRIGGER enforce_retro_note
  BEFORE INSERT OR UPDATE ON public.retro_notes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_retro_note();

CREATE OR REPLACE FUNCTION private.record_retro_note_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recorded for EVERY note, anonymous or not. On a named retro it duplicates author_id,
  -- deliberately: one code path, one policy, and no branch that could be got wrong the day
  -- somebody adds a fifth writer.
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.retro_note_authors (note_id, user_id)
    VALUES (NEW.id, auth.uid())
    ON CONFLICT (note_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_retro_note_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_retro_note_author ON public.retro_notes;
CREATE TRIGGER record_retro_note_author
  AFTER INSERT ON public.retro_notes
  FOR EACH ROW EXECUTE FUNCTION private.record_retro_note_author();

/** The vote count, computed from the votes and stored so it can be read without reading them. */
CREATE OR REPLACE FUNCTION private.recount_retro_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note UUID := COALESCE(NEW.note_id, OLD.note_id);
BEGIN
  -- The permit, set with is_local = true so it dies with the transaction, and cleared the
  -- moment the write is done. enforce_retro_note refuses a vote_count change without it.
  PERFORM set_config('retro.vote_recount', v_note::text, true);
  UPDATE public.retro_notes n
     SET vote_count = (SELECT count(*) FROM public.retro_votes v WHERE v.note_id = v_note)
   WHERE n.id = v_note;
  PERFORM set_config('retro.vote_recount', '', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.recount_retro_votes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS recount_retro_votes ON public.retro_votes;
CREATE TRIGGER recount_retro_votes
  AFTER INSERT OR DELETE ON public.retro_votes
  FOR EACH ROW EXECUTE FUNCTION private.recount_retro_votes();

/** Voting closes with the retrospective. */
CREATE OR REPLACE FUNCTION private.enforce_retro_vote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state TEXT;
BEGIN
  SELECT r.state INTO v_state
    FROM public.retro_notes n JOIN public.retrospectives r ON r.id = n.retro_id
   WHERE n.id = NEW.note_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'That note does not exist.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_state <> 'open' THEN
    RAISE EXCEPTION 'This retrospective is closed. Its votes are the record of what people agreed with.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A vote is always cast by the person casting it.
  NEW.user_id := COALESCE(auth.uid(), NEW.user_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_retro_vote() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_retro_vote ON public.retro_votes;
CREATE TRIGGER enforce_retro_vote
  BEFORE INSERT ON public.retro_votes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_retro_vote();

/** Conversion is stamped, never supplied - 130's rule for ideas. */
CREATE OR REPLACE FUNCTION private.enforce_retro_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.note_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.retro_notes n WHERE n.id = NEW.note_id AND n.retro_id = NEW.retro_id
  ) THEN
    RAISE EXCEPTION 'That note belongs to a different retrospective.' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.task_id IS NOT NULL OR NEW.converted_at IS NOT NULL THEN
      RAISE EXCEPTION 'An action cannot be created already converted. Create it, then turn it into work.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.converted_at := NULL;
    RETURN NEW;
  END IF;

  NEW.converted_at := CASE WHEN NEW.task_id IS NOT NULL THEN COALESCE(OLD.converted_at, now()) ELSE NULL END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_retro_action() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_retro_action ON public.retro_actions;
CREATE TRIGGER enforce_retro_action
  BEFORE INSERT OR UPDATE ON public.retro_actions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_retro_action();

-- ---------------------------------------------------------------------------------------
-- 9. The two functions the client is allowed to call.
-- ---------------------------------------------------------------------------------------

/** Used by the note policies. Never returns anything to a client. */
CREATE OR REPLACE FUNCTION private.is_retro_note_author(p_note UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.retro_note_authors a
     WHERE a.note_id = p_note AND a.user_id = auth.uid()
  );
$$;

-- ⚠️ EXECUTE IS GRANTED TO authenticated, and it must be. Measured against this database
-- rather than reasoned about: `authenticated` holds NO USAGE on schema `private`, so nobody can
-- call this directly - but an RLS POLICY that calls a function checks EXECUTE against the
-- CALLER, not against the table owner. Without this grant the note UPDATE and DELETE policies
-- fail with "permission denied for function is_retro_note_author" for every user, which reads
-- as broken auth rather than a missing grant. Every other policy helper in this schema
-- (is_admin_user, is_active_user, can_view_task, can_manage_task) carries the same pair, and
-- 101's is_active_user is the worked example.
REVOKE ALL ON FUNCTION private.is_retro_note_author(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_retro_note_author(UUID) TO authenticated;

/**
 * Which notes in this retrospective are MINE.
 *
 * ⚠️ It returns ids and nothing else, for the caller and nobody else. That is the narrowest
 * answer to the question the screen actually has to ask ("which of these can I edit"), and it
 * is the documented shape in this codebase for reaching past RLS - 122's notify_task_watchers
 * counts recipients without ever handing the list back.
 *
 * ⚠️ EXECUTE IS GRANTED EXPLICITLY, and revoked from PUBLIC and anon first, because
 * `REVOKE ... FROM PUBLIC` alone does NOT make a function private in this database: postgres
 * carries a default ACL granting EXECUTE on every new function in `public` to `authenticated`
 * (117's lesson, found by querying has_function_privilege rather than by reasoning).
 */
CREATE OR REPLACE FUNCTION public.my_retro_note_ids(p_retro UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id
    FROM public.retro_notes n
    JOIN public.retro_note_authors a ON a.note_id = n.id
   WHERE n.retro_id = p_retro
     AND a.user_id = auth.uid()
     -- The caller must be able to see the retrospective at all. A definer function that
     -- skipped this would confirm the existence of a private board's session by returning
     -- rows for it.
     AND EXISTS (
       SELECT 1 FROM public.retrospectives r
        JOIN public.boards b ON b.id = r.board_id
       WHERE r.id = n.retro_id
     );
$$;

REVOKE ALL ON FUNCTION public.my_retro_note_ids(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_retro_note_ids(UUID) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 10. Grants. REVOKE first (095).
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.retrospectives     FROM anon, authenticated;
REVOKE ALL ON public.retro_note_groups  FROM anon, authenticated;
REVOKE ALL ON public.retro_notes        FROM anon, authenticated;
REVOKE ALL ON public.retro_note_authors FROM anon, authenticated;
REVOKE ALL ON public.retro_votes        FROM anon, authenticated;
REVOKE ALL ON public.retro_actions      FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retrospectives    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retro_note_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retro_actions     TO authenticated;

-- ⚠️ COLUMN-LEVEL UPDATE. `author_id` and `vote_count` are absent from this list on purpose,
-- so neither can be written however the request is shaped. 101's lesson applies in reverse:
-- a column-level REVOKE cannot shrink a table-wide grant, so the table-wide grant must never
-- be issued in the first place - which is why the REVOKE above comes first and the UPDATE
-- here names its columns.
GRANT SELECT, INSERT, DELETE ON public.retro_notes TO authenticated;
GRANT UPDATE (body, column_key, group_id, position) ON public.retro_notes TO authenticated;

-- No UPDATE at all: a vote is cast or withdrawn, never edited.
GRANT SELECT, INSERT, DELETE ON public.retro_votes TO authenticated;

-- retro_note_authors: NOTHING. This is the anonymity boundary and it is a grant that is not
-- issued rather than a policy that could be widened.

-- ---------------------------------------------------------------------------------------
-- 11. RLS. Board scope read through the caller's own boards policy, as everywhere else.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.retrospectives     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retro_note_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retro_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retro_note_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retro_votes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retro_actions      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read retrospectives on boards you can see" ON public.retrospectives;
CREATE POLICY "Read retrospectives on boards you can see" ON public.retrospectives
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.boards b WHERE b.id = retrospectives.board_id));

-- Guests and clients are read-only on a board (065), and a retrospective is a working session
-- about that board's work. Fifth copy of that predicate; if a fourth role is ever added to
-- board_members_role_check, FIVE places need updating.
DROP POLICY IF EXISTS "Members run retrospectives on boards they can see" ON public.retrospectives;
CREATE POLICY "Members run retrospectives on boards they can see" ON public.retrospectives
  FOR ALL
  USING (
    private.is_active_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = retrospectives.board_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.board_members bm
       WHERE bm.board_id = retrospectives.board_id AND bm.user_id = auth.uid()
         AND bm.role IN ('guest', 'client')
    )
  )
  WITH CHECK (
    private.is_active_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = retrospectives.board_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.board_members bm
       WHERE bm.board_id = retrospectives.board_id AND bm.user_id = auth.uid()
         AND bm.role IN ('guest', 'client')
    )
  );

DROP POLICY IF EXISTS "Read groups in retrospectives you can see" ON public.retro_note_groups;
CREATE POLICY "Read groups in retrospectives you can see" ON public.retro_note_groups
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.retrospectives r WHERE r.id = retro_note_groups.retro_id));

DROP POLICY IF EXISTS "Participants group notes" ON public.retro_note_groups;
CREATE POLICY "Participants group notes" ON public.retro_note_groups
  FOR ALL
  USING (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retrospectives r
       JOIN public.boards b ON b.id = r.board_id
      WHERE r.id = retro_note_groups.retro_id
        AND NOT EXISTS (
          SELECT 1 FROM public.board_members bm
           WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
        )
    )
  )
  WITH CHECK (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retrospectives r
       JOIN public.boards b ON b.id = r.board_id
      WHERE r.id = retro_note_groups.retro_id
        AND NOT EXISTS (
          SELECT 1 FROM public.board_members bm
           WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
        )
    )
  );

DROP POLICY IF EXISTS "Read notes in retrospectives you can see" ON public.retro_notes;
CREATE POLICY "Read notes in retrospectives you can see" ON public.retro_notes
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.retrospectives r WHERE r.id = retro_notes.retro_id));

DROP POLICY IF EXISTS "Participants write notes" ON public.retro_notes;
CREATE POLICY "Participants write notes" ON public.retro_notes
  FOR INSERT WITH CHECK (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retrospectives r
       WHERE r.id = retro_notes.retro_id
         AND NOT EXISTS (
           SELECT 1 FROM public.board_members bm
            WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
         )
    )
  );

-- ⚠️ Editing goes through the definer helper, so it works identically on an anonymous retro
-- WITHOUT the caller ever being able to ask who wrote anything else. An admin deliberately
-- cannot edit somebody else's words - only remove them (below). Rewriting a person's
-- retrospective note and leaving it attributed to them is worse than deleting it.
DROP POLICY IF EXISTS "The author edits their own note" ON public.retro_notes;
CREATE POLICY "The author edits their own note" ON public.retro_notes
  FOR UPDATE
  USING (private.is_active_user() AND private.is_retro_note_author(id))
  WITH CHECK (private.is_active_user() AND private.is_retro_note_author(id));

DROP POLICY IF EXISTS "The author or an admin removes a note" ON public.retro_notes;
CREATE POLICY "The author or an admin removes a note" ON public.retro_notes
  FOR DELETE USING (
    private.is_active_user()
    AND (
      private.is_retro_note_author(id)
      OR (
        private.is_admin_user()
        AND EXISTS (SELECT 1 FROM public.retrospectives r WHERE r.id = retro_notes.retro_id)
      )
    )
  );

-- ⚠️ NO POLICY ON retro_note_authors AT ALL, and no grant either. Both halves are asserted
-- below. A policy here would be a door in a wall that has none.

-- Your own votes, in every direction. There is deliberately no way to read anybody else's.
DROP POLICY IF EXISTS "Your own votes" ON public.retro_votes;
CREATE POLICY "Your own votes" ON public.retro_votes
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retro_notes n
       JOIN public.retrospectives r ON r.id = n.retro_id
      WHERE n.id = retro_votes.note_id
        AND NOT EXISTS (
          SELECT 1 FROM public.board_members bm
           WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
        )
    )
  );

DROP POLICY IF EXISTS "Read actions in retrospectives you can see" ON public.retro_actions;
CREATE POLICY "Read actions in retrospectives you can see" ON public.retro_actions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.retrospectives r WHERE r.id = retro_actions.retro_id));

DROP POLICY IF EXISTS "Participants manage actions" ON public.retro_actions;
CREATE POLICY "Participants manage actions" ON public.retro_actions
  FOR ALL
  USING (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retrospectives r
       WHERE r.id = retro_actions.retro_id
         AND NOT EXISTS (
           SELECT 1 FROM public.board_members bm
            WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
         )
    )
  )
  WITH CHECK (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.retrospectives r
       WHERE r.id = retro_actions.retro_id
         AND NOT EXISTS (
           SELECT 1 FROM public.board_members bm
            WHERE bm.board_id = r.board_id AND bm.user_id = auth.uid() AND bm.role IN ('guest', 'client')
         )
    )
  );

-- ---------------------------------------------------------------------------------------
-- 12. Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_boards  BIGINT;
  v_tasks   BIGINT;
  v_modules BIGINT;
  v_board   UUID;
  v_retro   UUID;
  v_note    UUID;
  v_refused BOOLEAN;
BEGIN
  SELECT board_rows, task_rows, module_rows INTO v_boards, v_tasks, v_modules FROM _132_precheck;
  IF (SELECT count(*) FROM public.boards) <> v_boards THEN RAISE EXCEPTION 'Board rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.tasks)  <> v_tasks  THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.app_modules) <> v_modules THEN RAISE EXCEPTION 'app_modules changed. Aborting.'; END IF;

  IF (SELECT count(*) FROM public.retrospectives) <> 0 THEN RAISE EXCEPTION 'retrospectives seeded rows. Aborting.'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('retrospectives', 'retro_note_groups', 'retro_notes', 'retro_note_authors', 'retro_votes', 'retro_actions')
       AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on every new retro table. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('retrospectives', 'retro_note_groups', 'retro_notes', 'retro_note_authors', 'retro_votes', 'retro_actions')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on a retro table. Aborting.';
  END IF;

  -- ⚠️ THE ANONYMITY BOUNDARY, asserted twice: no grant, and no policy.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'retro_note_authors'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'A client role holds a grant on retro_note_authors. Anonymity is not enforced. Aborting.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retro_note_authors') THEN
    RAISE EXCEPTION 'retro_note_authors has a policy. It must have none. Aborting.';
  END IF;

  -- author_id and vote_count must be un-writable.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'retro_notes'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
       AND column_name IN ('author_id', 'vote_count')
  ) THEN
    RAISE EXCEPTION 'authenticated can UPDATE author_id or vote_count on retro_notes. Aborting.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'retro_votes'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated can UPDATE retro_votes. A vote is cast or withdrawn. Aborting.';
  END IF;

  -- ⚠️ The grant an RLS policy needs. A policy calling a function checks EXECUTE against the
  -- CALLER, so without this every note edit fails with "permission denied for function" - which
  -- is what happened on the first run of this migration, caught by check-strategy.mjs and not
  -- by reading. anon must still be refused: it can reach no policy that would call it.
  IF NOT has_function_privilege('authenticated', 'private.is_retro_note_author(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute is_retro_note_author, so the note policies will refuse everyone. Aborting.';
  END IF;
  IF has_function_privilege('anon', 'private.is_retro_note_author(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute is_retro_note_author. Aborting.';
  END IF;

  -- 117's lesson: REVOKE ... FROM PUBLIC does not make a function private here.
  IF has_function_privilege('anon', 'public.my_retro_note_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute my_retro_note_ids. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.my_retro_note_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute my_retro_note_ids. Aborting.';
  END IF;

  -- ---- Behaviour, on a throwaway board that is removed again below.
  INSERT INTO public.boards (title, created_by) VALUES ('_132 self-test board', NULL) RETURNING id INTO v_board;

  INSERT INTO public.retrospectives (board_id, title, template, is_anonymous)
  VALUES (v_board, '_132 self-test', 'start_stop_continue', true) RETURNING id INTO v_retro;

  -- A note filed under a column the template does not have is refused, never stored.
  v_refused := false;
  BEGIN
    INSERT INTO public.retro_notes (retro_id, column_key, body) VALUES (v_retro, 'well', 'wrong column');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'A note was filed under a column the template does not have. Aborting.'; END IF;

  INSERT INTO public.retro_notes (retro_id, column_key, body, author_id)
  VALUES (v_retro, 'start', 'anonymous note', NULL) RETURNING id INTO v_note;

  -- The public author must be NULL on an anonymous retro whatever the caller sent.
  IF (SELECT author_id FROM public.retro_notes WHERE id = v_note) IS NOT NULL THEN
    RAISE EXCEPTION 'An anonymous note carries a public author. Aborting.';
  END IF;

  -- Anonymity cannot be switched off after the fact.
  v_refused := false;
  BEGIN
    UPDATE public.retrospectives SET is_anonymous = false WHERE id = v_retro;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'Anonymity was switched off after notes existed. Aborting.'; END IF;

  -- The template cannot change once notes are filed.
  v_refused := false;
  BEGIN
    UPDATE public.retrospectives SET template = 'four_ls' WHERE id = v_retro;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'The template changed under existing notes. Aborting.'; END IF;

  -- Votes count themselves.
  INSERT INTO public.retro_votes (note_id, user_id)
  SELECT v_note, p.id FROM public.profiles p LIMIT 1;
  IF (SELECT vote_count FROM public.retro_notes WHERE id = v_note) <> 1 THEN
    RAISE EXCEPTION 'A vote did not reach the count. Aborting.';
  END IF;
  DELETE FROM public.retro_votes WHERE note_id = v_note;
  IF (SELECT vote_count FROM public.retro_notes WHERE id = v_note) <> 0 THEN
    RAISE EXCEPTION 'Withdrawing a vote did not reach the count. Aborting.';
  END IF;

  -- ⚠️ The recount permit must not be forgeable. Setting it by hand and moving the number is
  -- exactly the forgery it exists to prevent, so the assertion is the attack, not the rule.
  v_refused := false;
  BEGIN
    PERFORM set_config('retro.vote_recount', v_note::text, true);
    UPDATE public.retro_notes SET vote_count = 99, body = 'and a smuggled edit' WHERE id = v_note;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  PERFORM set_config('retro.vote_recount', '', true);
  IF NOT v_refused THEN RAISE EXCEPTION 'An edit rode along with a vote recount. Aborting.'; END IF;
  IF (SELECT vote_count FROM public.retro_notes WHERE id = v_note) <> 0 THEN
    RAISE EXCEPTION 'A forged vote count survived. Aborting.';
  END IF;

  -- A closed retro takes no more notes.
  UPDATE public.retrospectives SET state = 'closed' WHERE id = v_retro;
  v_refused := false;
  BEGIN
    INSERT INTO public.retro_notes (retro_id, column_key, body) VALUES (v_retro, 'stop', 'too late');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'A closed retrospective accepted a new note. Aborting.'; END IF;

  -- An action cannot be born converted.
  v_refused := false;
  BEGIN
    INSERT INTO public.retro_actions (retro_id, body, converted_at) VALUES (v_retro, 'x', now());
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'An action was created already converted. Aborting.'; END IF;

  DELETE FROM public.boards WHERE id = v_board;
  IF (SELECT count(*) FROM public.retrospectives) <> 0 THEN RAISE EXCEPTION 'Self-test retro survived. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.retro_note_authors) <> 0 THEN RAISE EXCEPTION 'Self-test author rows survived. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.boards) <> v_boards THEN RAISE EXCEPTION 'Board rows moved after self-test. Aborting.'; END IF;

  RAISE NOTICE '132 OK: retrospectives installed; anonymity is a grant that does not exist, not a flag.';
END;
$$;

COMMIT;
