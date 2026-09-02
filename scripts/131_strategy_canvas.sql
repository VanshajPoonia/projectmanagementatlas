-- 131: the one strategy canvas worth building - SWOT.
--
-- WHY SO LITTLE
-- Prompt H is unusually blunt here: "Only add canvases that users will actually use... Do not
-- build a whiteboard engine merely to claim parity." It lists four candidates, and this
-- migration deliberately implements ONE of them and computes a second from data that already
-- exists:
--
--   SWOT            -> built. Four buckets of short statements, which is all it has ever been.
--   impact / effort -> NO SCHEMA AT ALL. 130 already stores `impact` and `effort` on every
--                      idea, so the matrix is a way of LOOKING at the idea pipeline. A second
--                      table holding the same two judgements would be two sources of truth for
--                      one fact, which is the defect this codebase most often has to unpick.
--   Lean Canvas     -> not built. It is a startup artifact for validating a new business, and
--                      this workspace runs a contracting and real-estate operation. Adding it
--                      "for parity" is exactly what the prompt forbids. It is nine text boxes
--                      and one widened CHECK on the day somebody actually asks.
--   stakeholder map -> not built, and this is the one with a real cost: a MAP means positions,
--                      and positions mean a canvas engine with drag, zoom and collision. The
--                      useful half - who the stakeholders are - is already a field on
--                      board_purpose (129). A picture of it is not worth a whiteboard.
--
-- ⚠️ `canvas` is a column and not a table name for exactly this reason. Adding Lean Canvas
-- later is one branch in one CHECK plus one list of bucket keys in lib/strategy.ts. That is
-- not speculative generality - it is refusing to paint the schema into a corner while still
-- shipping only what was asked for.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: one NEW table, one trigger on that new table, nothing seeded. Eligible.
-- Rollback: scripts/rollback/131_revert.sql (destroys every canvas entry).

BEGIN;

CREATE TEMP TABLE _131_precheck ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.boards) AS board_rows,
       (SELECT count(*) FROM public.app_modules) AS module_rows;

CREATE TABLE IF NOT EXISTS public.strategy_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means the whole organisation. A SWOT is written at both levels in practice and the
  -- alternative is two tables that differ by one column.
  board_id   UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  canvas     TEXT NOT NULL DEFAULT 'swot' CHECK (canvas IN ('swot')),
  bucket     TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  position   INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The bucket is only meaningful against its canvas, and a CHECK is the only place that can
  -- be enforced regardless of what writes the row. A second canvas adds one OR branch.
  CONSTRAINT strategy_items_bucket_matches_canvas CHECK (
    (canvas = 'swot' AND bucket IN ('strength', 'weakness', 'opportunity', 'threat'))
  )
);

CREATE INDEX IF NOT EXISTS idx_strategy_items_scope
  ON public.strategy_items(canvas, board_id, bucket, position);

COMMENT ON TABLE public.strategy_items IS
  'Entries on a strategy canvas. board_id NULL means the whole organisation. Deliberately not '
  'a whiteboard: there are no coordinates here, because a SWOT is four lists and drawing it '
  'as a diagram adds an engine and no information.';

DROP TRIGGER IF EXISTS touch_strategy_items ON public.strategy_items;
CREATE TRIGGER touch_strategy_items
  BEFORE UPDATE ON public.strategy_items
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- REVOKE first: Supabase default-grants ALL on every new public table (095).
REVOKE ALL ON public.strategy_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_items TO authenticated;

ALTER TABLE public.strategy_items ENABLE ROW LEVEL SECURITY;

-- Org-level entries are visible to everyone signed in; a board-level entry follows the board,
-- read through the CALLER'S OWN boards policy so a private board's SWOT is invisible to a
-- non-member without this policy knowing what board privacy is (119/123/129's pattern).
DROP POLICY IF EXISTS "Read canvas entries in scopes you can see" ON public.strategy_items;
CREATE POLICY "Read canvas entries in scopes you can see" ON public.strategy_items
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      board_id IS NULL
      OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = strategy_items.board_id)
    )
  );

-- A SWOT is a statement about the organisation or the project, so writing one is admin -
-- the same tier as board_purpose (129) and board_agile_settings (123).
DROP POLICY IF EXISTS "Admins write canvas entries in scopes they can see" ON public.strategy_items;
CREATE POLICY "Admins write canvas entries in scopes they can see" ON public.strategy_items
  FOR ALL
  USING (
    private.is_admin_user()
    AND (board_id IS NULL OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = strategy_items.board_id))
  )
  WITH CHECK (
    private.is_admin_user()
    AND (board_id IS NULL OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = strategy_items.board_id))
  );

DO $$
DECLARE
  v_boards  BIGINT;
  v_modules BIGINT;
  v_refused BOOLEAN;
  v_id      UUID;
BEGIN
  SELECT board_rows, module_rows INTO v_boards, v_modules FROM _131_precheck;
  IF (SELECT count(*) FROM public.boards) <> v_boards THEN RAISE EXCEPTION 'Board rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.app_modules) <> v_modules THEN RAISE EXCEPTION 'app_modules changed. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.strategy_items) <> 0 THEN RAISE EXCEPTION 'strategy_items seeded rows. Aborting.'; END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'strategy_items') THEN
    RAISE EXCEPTION 'RLS is not enabled on strategy_items. Aborting.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'strategy_items' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on strategy_items. Aborting.';
  END IF;

  -- A bucket that does not belong to its canvas must be refused, not stored. Tried, not
  -- described (117): "the constraint exists" and "the constraint refuses this" differ.
  v_refused := false;
  BEGIN
    INSERT INTO public.strategy_items (canvas, bucket, body) VALUES ('swot', 'problem', 'wrong bucket');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'A bucket from another canvas was accepted. Aborting.'; END IF;

  INSERT INTO public.strategy_items (canvas, bucket, body) VALUES ('swot', 'strength', '_131 self-test')
  RETURNING id INTO v_id;
  DELETE FROM public.strategy_items WHERE id = v_id;
  IF (SELECT count(*) FROM public.strategy_items) <> 0 THEN RAISE EXCEPTION 'Self-test entries survived. Aborting.'; END IF;

  RAISE NOTICE '131 OK: SWOT installed; impact/effort reads the idea pipeline and stores nothing.';
END;
$$;

COMMIT;
