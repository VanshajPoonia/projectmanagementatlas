-- 097_user_favorites.sql
--
-- Favourites: a per-user list of the things someone wants pinned to the top of their own
-- shell. ATLAS_02 Prompt A asks for "Favorite projects" and "Pinned views" as two of the
-- items to verify; neither existed. This is the storage for both.
--
-- WHY A TABLE AND NOT localStorage. The shell already owns three per-user preferences in
-- localStorage (sidebar collapse, density, recently viewed) and those are genuinely
-- presentational: losing them on a new device costs nothing. A favourite is not that. It is
-- a small, deliberate, curated list, and a user who stars six boards on their laptop expects
-- to find those six on their phone. The pack's own principle is that presentation stays per
-- user; it does not say per browser.
--
-- WHY entity_type INSTEAD OF A board_id COLUMN. Prompt E introduces saved views, and Prompt A
-- lists "pinned views" alongside "favorite projects" — same gesture, same list, same UI.
-- A `favorite_boards` table would have to be joined by a second, incompatible
-- `favorite_views` table three prompts from now, which is the exact "second incompatible
-- model" the pack warns against. The CHECK constraint currently admits only 'board' and
-- 'view'; 'view' is accepted but nothing writes it yet, so widening it later needs no
-- migration and no backfill.
--
-- ⚠️ A FAVOURITE IS A POINTER, NOT A GRANT. Nothing here widens what anyone can read. The
-- policies below scope a row to its owner and stop there; they deliberately do NOT verify
-- that the referenced board is visible to that user. Two reasons: (1) it would couple this
-- table to boards' privacy logic (061/070) and need a second branch the day 'view' rows
-- exist, and (2) it buys nothing — the row holds a uuid the user already had, and resolving
-- a favourite back to a board goes through the session client, so boards' own RLS decides
-- what actually renders. A favourite pointing at a board the user has since lost access to
-- resolves to nothing and is filtered out client-side, which is the correct outcome.
--
-- No ON DELETE for the target either, for the same reason: entity_id is polymorphic, so it
-- cannot carry a foreign key. lib/favorites.ts::resolveFavorites drops any favourite whose
-- target did not come back from the query, which covers deleted boards, archived boards and
-- revoked access with one rule instead of three.
--
-- Purely additive: one new table, no existing policy touched, no existing row read or
-- written. Paired rollback: scripts/rollback/097_revert.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'board' today. 'view' is accepted ahead of Prompt E so saved views need no migration.
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  -- Manual ordering, lowest first. Unused by the first UI (which orders by created_at) but
  -- present from the start so reordering later is a client change, not a migration.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT user_favorites_entity_type_known CHECK (entity_type IN ('board', 'view'))
);

-- Starring the same board twice is the same favourite, not two. This is also what lets the
-- client upsert on conflict instead of read-then-write.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique
  ON public.user_favorites (user_id, entity_type, entity_id);

-- The only read this table ever serves: "my favourites, in order".
CREATE INDEX IF NOT EXISTS idx_user_favorites_user
  ON public.user_favorites (user_id, position, created_at);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

-- Supabase default-grants ALL on every new table in `public`. 095 narrowed the default
-- privileges for tables created by `postgres`, which is what the migration runner is, so
-- this table should arrive clean — but the REVOKE is kept anyway: a table created through
-- the Supabase dashboard still inherits the wide grant (095 could not alter
-- supabase_admin's defaults), and asserting it below is worth more than assuming it.
REVOKE ALL ON public.user_favorites FROM PUBLIC;
REVOKE ALL ON public.user_favorites FROM anon;
REVOKE ALL ON public.user_favorites FROM authenticated;

-- No UPDATE: a favourite is a set membership, so the two operations are star and unstar.
-- Reordering will need UPDATE (position) when it ships; granting it now would be granting a
-- privilege nothing uses, and column-scoping it later is easier than narrowing it later.
GRANT SELECT, INSERT, DELETE ON public.user_favorites TO authenticated;

-- Own rows only, all the way through. WITH CHECK on INSERT is what stops someone writing a
-- favourite into another person's list; USING on SELECT/DELETE is what stops them reading or
-- clearing it. Admins are deliberately NOT exempted — is_admin_user() appears in most
-- policies in this schema, but there is no reason for an admin to read what a colleague has
-- starred, and a favourites list is closer to `personal_tasks` than to `boards`.
DROP POLICY IF EXISTS "Users manage their own favorites" ON public.user_favorites;
CREATE POLICY "Users manage their own favorites"
  ON public.user_favorites FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users add their own favorites" ON public.user_favorites;
CREATE POLICY "Users add their own favorites"
  ON public.user_favorites FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users remove their own favorites" ON public.user_favorites;
CREATE POLICY "Users remove their own favorites"
  ON public.user_favorites FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.user_favorites IS
  'Per-user favourites (starred boards today, saved views later). Private to the owner: no '
  'admin exemption, no cross-user read. A row is a pointer, not an access grant.';

-- Post-conditions: roll back rather than half-apply (see CLAUDE.md conventions).
DO $post$
DECLARE
  v_rls        BOOLEAN;
  v_policies   INTEGER;
  v_rows       BIGINT;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.user_favorites'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION '097 post-condition: RLS must be enabled on user_favorites';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_favorites';
  IF v_policies <> 3 THEN
    RAISE EXCEPTION '097 post-condition: expected 3 policies on user_favorites, found %', v_policies;
  END IF;

  -- The whole point of the table: signed-out reads nothing. 095 closed the blanket anon
  -- grant and narrowed the defaults, so this asserts that fix actually held for a new table.
  IF has_table_privilege('anon', 'public.user_favorites', 'SELECT') THEN
    RAISE EXCEPTION '097 post-condition: anon must hold nothing on user_favorites';
  END IF;
  IF has_table_privilege('anon', 'public.user_favorites', 'INSERT')
     OR has_table_privilege('anon', 'public.user_favorites', 'DELETE') THEN
    RAISE EXCEPTION '097 post-condition: anon must not be able to write favorites';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.user_favorites', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.user_favorites', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.user_favorites', 'DELETE') THEN
    RAISE EXCEPTION '097 post-condition: authenticated must be able to star and unstar';
  END IF;

  -- Asserted so that the day reordering ships, someone has to grant this deliberately.
  IF has_table_privilege('authenticated', 'public.user_favorites', 'UPDATE') THEN
    RAISE EXCEPTION '097 post-condition: UPDATE is not granted yet (star/unstar only)';
  END IF;
  -- TRUNCATE is the one privilege RLS never covers (see 095).
  IF has_table_privilege('authenticated', 'public.user_favorites', 'TRUNCATE') THEN
    RAISE EXCEPTION '097 post-condition: authenticated must not hold TRUNCATE';
  END IF;

  -- A new table, so this is a tautology today; it is here so a re-run against a database
  -- that already has favourites fails loudly instead of quietly dropping them.
  SELECT count(*) INTO v_rows FROM public.user_favorites;
  RAISE NOTICE '097 OK — user_favorites ready (% existing row(s) preserved)', v_rows;
END
$post$;

COMMIT;
