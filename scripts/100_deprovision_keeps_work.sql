-- Deleting a person removes the account, not their work.
--
-- Today a super admin cannot delete most accounts at all, and the ones they CAN delete lose
-- work that belongs to the company. Both come from foreign keys that disagree with the
-- columns they sit on:
--
--   boards.created_by        NOT NULL + ON DELETE SET NULL  -> deletion always fails
--   tasks.created_by         NOT NULL + ON DELETE SET NULL  -> deletion always fails
--   task_comments.user_id    NOT NULL + ON DELETE CASCADE   -> comments are destroyed
--   task_comments.author_id  nullable + ON DELETE CASCADE   -> same row, same outcome
--   bookmarks.created_by     NOT NULL + ON DELETE CASCADE   -> company bookmarks destroyed
--
-- The first two are a straight contradiction: the FK promises to write NULL into a column
-- that forbids NULL, so Postgres aborts the whole delete with "Database error deleting
-- user". Every board here is created by an admin, so in practice NO admin account could
-- ever be removed. That is why the constraint has never been hit deliberately — the failure
-- looks like a Supabase problem rather than a schema one.
--
-- The other three quietly delete work when the delete does succeed. `bookmarks` is the
-- clearest case: scope='company' rows are shared with everyone and carry user_id = NULL, so
-- CASCADE on created_by was the only thing pointing at them. Personal bookmarks are
-- unaffected — they carry user_id and still cascade through it, which is what should happen
-- to somebody's private list.
--
-- ── Attribution vs control ───────────────────────────────────────────────────────────
-- Everything here becomes SET NULL rather than being reassigned to somebody else, because
-- rewriting an author would put words in a living person's mouth: a comment or a task would
-- claim to have been written by whoever happened to run the deletion. NULL is the honest
-- record — "someone who no longer has an account" — and the UI renders it as such.
--
-- CONTROL is the exception, and it is handled in app code rather than here.
-- app/api/admin/delete-user/route.ts reassigns BOARDS to the super admin performing the
-- deletion before the account goes, because `boards.created_by` is not attribution: 061
-- makes it the sole authority over a private board's membership list. A board left with a
-- NULL creator could never have its members changed again by anyone. The nullable column
-- below is the backstop for any path that bypasses that route (raw SQL, a future script),
-- so the delete degrades to "orphaned but intact" instead of failing outright.
--
-- Deliberately left as CASCADE: share_links.created_by. A public share URL minted by someone
-- who has since been removed should stop working, not outlive them.

BEGIN;

-- ── 1. The two contradictions that block deletion outright ───────────────────────────
ALTER TABLE public.boards ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.tasks  ALTER COLUMN created_by DROP NOT NULL;

-- ── 2. Preserve comments ─────────────────────────────────────────────────────────────
ALTER TABLE public.task_comments ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  v_name text;
BEGIN
  -- Constraint names are not guaranteed, so find them rather than assuming. Each FK is
  -- rebuilt with the same target and a SET NULL rule.
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.conrelid = 'public.task_comments'::regclass
      AND con.contype = 'f'
      AND a.attname IN ('user_id', 'author_id')
  LOOP
    EXECUTE format('ALTER TABLE public.task_comments DROP CONSTRAINT %I', v_name);
  END LOOP;

  ALTER TABLE public.task_comments
    ADD CONSTRAINT task_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

  ALTER TABLE public.task_comments
    ADD CONSTRAINT task_comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
END $$;

-- ── 3. Preserve company bookmarks ────────────────────────────────────────────────────
ALTER TABLE public.bookmarks ALTER COLUMN created_by DROP NOT NULL;

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.conrelid = 'public.bookmarks'::regclass
    AND con.contype = 'f'
    AND a.attname = 'created_by';

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bookmarks DROP CONSTRAINT %I', v_name);
  END IF;

  ALTER TABLE public.bookmarks
    ADD CONSTRAINT bookmarks_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
END $$;

-- ── 4. Record the deletion itself ────────────────────────────────────────────────────
-- The biggest access change of all had no audit event. Reads OLD directly rather than
-- calling private.audit_person_name(), because by the time this fires the profile is gone.
CREATE OR REPLACE FUNCTION private.audit_profile_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.record_audit_event(
    'profile.deleted', 'profile', OLD.id, OLD.id,
    format('%s''s account was deleted. Their boards, tasks and comments were kept.',
           COALESCE(NULLIF(TRIM(OLD.full_name), ''), OLD.email, 'A user')),
    jsonb_build_object('email', OLD.email, 'role', OLD.role)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_deleted ON public.profiles;
CREATE TRIGGER trg_audit_profile_deleted
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_profile_deleted();

-- ── Post-conditions ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad int;
BEGIN
  -- The exact contradiction this migration exists to remove: NOT NULL that an ON DELETE
  -- SET NULL rule would have to violate. Zero, anywhere, for any FK pointing at profiles.
  SELECT count(*) INTO v_bad
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_class f ON f.oid = con.confrelid
  JOIN pg_namespace fn ON fn.oid = f.relnamespace
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND f.relname = 'profiles' AND fn.nspname = 'public'
    AND con.confdeltype = 'n'
    AND a.attnotnull;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% column(s) are still NOT NULL with an ON DELETE SET NULL rule', v_bad;
  END IF;

  -- Comments and company bookmarks must now survive their author.
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.conrelid = 'public.task_comments'::regclass AND con.contype = 'f'
      AND a.attname IN ('user_id', 'author_id') AND con.confdeltype <> 'n'
  ) THEN
    RAISE EXCEPTION 'task_comments still has a non-SET-NULL author foreign key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.conrelid = 'public.bookmarks'::regclass AND con.contype = 'f'
      AND a.attname = 'created_by' AND con.confdeltype <> 'n'
  ) THEN
    RAISE EXCEPTION 'bookmarks.created_by still cascades';
  END IF;

  -- Personal bookmarks must STILL be removed with their owner; only the shared ones are
  -- being rescued here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.conrelid = 'public.bookmarks'::regclass AND con.contype = 'f'
      AND a.attname = 'user_id' AND con.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'bookmarks.user_id should still CASCADE so personal lists are cleaned up';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_profile_deleted' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'the account-deletion audit trigger is missing';
  END IF;
END $$;

COMMIT;
