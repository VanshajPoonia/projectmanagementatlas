-- Adds boards.updated_by so the boards list can show "Last edited {date} by {user}"
-- instead of "Created {date} by {user}". boards.updated_at has existed since
-- 001_initial_schema.sql but nothing ever wrote to it after insert — board edits
-- (title/description/color/visibility) never touched it. The app code is changing in
-- the same pass to bump updated_at/updated_by whenever a board is edited.
--
-- Nullable + ON DELETE SET NULL (unlike created_by, which is NOT NULL / ON DELETE
-- CASCADE from 001) — losing the identity of the last editor should never cascade-delete
-- a board. Existing rows are backfilled to created_by: nobody has "edited" a board under
-- this new tracking yet, so its creator is factually the last (only) editor.
--
-- References profiles(id), not auth.users(id) — matching created_by/archived_by
-- (re-pointed at profiles in 010_add_foreign_keys.sql). PostgREST's `profiles!<fkey>` embed
-- syntax (used by every boards query in the app) needs the FK to target profiles directly;
-- pointing at auth.users instead breaks the embed with PGRST200 ("could not find a
-- relationship"), which was caught when the boards list came back empty end-to-end.

BEGIN;

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.boards SET updated_by = created_by WHERE updated_by IS NULL;

COMMIT;
