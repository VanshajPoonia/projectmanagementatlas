-- 115: relations between work items, kept separate from hierarchy.
--
-- WHY THIS IS NOT parent_task_id
-- The plan is explicit: "Separate hierarchy from relations... Do not use parent/child to
-- represent blocking." They answer different questions. A subtask is PART OF its parent - it
-- has no life of its own, it moves with it, deleting the parent deletes it. A blocker is a
-- separate, independent work item that happens to stand in the way, often on another board,
-- often owned by someone else. Modelling one as the other means either subtasks that cannot be
-- deleted independently, or blockers that vanish when unrelated work is removed.
--
-- ⚠️ `task_links` IS ALREADY TAKEN and is not this. Despite the name, task_links holds URL
-- bookmarks (title + url) attached to a task - external references, not work-item relations.
-- Anyone reaching for "the links table" to answer "what blocks this" will find the wrong one.
--
-- SEVEN RELATIONS, FOUR ROWS
-- The plan lists blocks, blocked by, related to, duplicate of, duplicated by, precedes and
-- follows. Those are four relationships seen from two ends:
--
--     blocks      <-> blocked_by
--     precedes    <-> follows
--     duplicates  <-> duplicated_by
--     relates_to  <-> relates_to        (symmetric)
--
-- Only the canonical direction is stored, and the inverse is derived by the
-- `task_relations_expanded` view. Storing both directions as separate rows is the obvious
-- alternative and it is the one that rots: two rows that must agree forever, where deleting
-- one leaves the other asserting a relationship that no longer exists in the other direction.
-- One row cannot disagree with itself.
--
-- `relates_to` is symmetric, so (A,B) and (B,A) are the same fact. A BEFORE trigger normalises
-- it to source < target so the UNIQUE constraint catches the duplicate; the alternative - a
-- unique index on LEAST/GREATEST - hides the rule inside an index expression where nothing
-- reading the table would see it.
--
-- CYCLES
-- `blocks`, `precedes` and `duplicates` must be acyclic. A blocks B blocks C blocks A is a
-- deadlock that no amount of work can resolve, and once stored it will be reported forever as
-- three items that cannot start. Checked with a recursive walk BEFORE the row lands.
-- `relates_to` is symmetric and unordered, so a "cycle" in it means nothing and is allowed.
--
-- ⚠️ THE VIEW MUST BE security_invoker
-- A Postgres view runs with its OWNER's privileges by default, which would make
-- task_relations_expanded a hole straight through the RLS policies below - any signed-in user
-- would read every relation between every task including private boards they cannot see. PG15+
-- offers `WITH (security_invoker = true)`, which makes the underlying table's policies apply to
-- the caller instead. This database is PostgreSQL 17. The post-conditions assert the option is
-- actually set, because getting this wrong is invisible from the view definition alone.
--
-- SAFETY
-- Purely additive: one new table, one view, two triggers on that new table. No existing table,
-- column, policy, grant or row is touched, so this is --allow-prod eligible on this repo's own
-- rule, and applying it changes nothing anyone can see until a relation is created (none are
-- seeded). Rollback: scripts/rollback/115_revert.sql.

BEGIN;

CREATE TEMP TABLE _115_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks) AS task_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

CREATE TABLE IF NOT EXISTS public.task_relations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  target_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT task_relations_type_check
    CHECK (relation_type IN ('blocks', 'precedes', 'duplicates', 'relates_to')),
  -- A work item cannot block, precede, duplicate or relate to itself. Every one of those is
  -- either meaningless or a one-item deadlock.
  CONSTRAINT task_relations_not_self CHECK (source_task_id <> target_task_id),
  CONSTRAINT task_relations_unique UNIQUE (source_task_id, target_task_id, relation_type)
);

COMMENT ON TABLE public.task_relations IS
  'Work-item relations, canonical direction only. The inverse (blocked_by, follows, '
  'duplicated_by) is derived by public.task_relations_expanded - never stored as a second row. '
  'Not to be confused with public.task_links, which holds external URL bookmarks.';

CREATE INDEX IF NOT EXISTS idx_task_relations_source ON public.task_relations(source_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_target ON public.task_relations(target_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_type ON public.task_relations(relation_type);

-- ---------------------------------------------------------------------------------------
-- Normalisation + cycle prevention
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_task_relation_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap UUID;
BEGIN
  -- Symmetric: order the pair so "A relates to B" and "B relates to A" are the same row and
  -- the UNIQUE constraint refuses the second one.
  IF NEW.relation_type = 'relates_to' AND NEW.source_task_id > NEW.target_task_id THEN
    v_swap             := NEW.source_task_id;
    NEW.source_task_id := NEW.target_task_id;
    NEW.target_task_id := v_swap;
  END IF;

  -- Directional relations must not close a loop. Walk forward from the proposed TARGET: if it
  -- can already reach the proposed SOURCE, this edge would complete a cycle.
  --
  -- Runs as SECURITY DEFINER and therefore sees every row regardless of RLS - deliberately. A
  -- cycle that passes through a task the caller cannot see is still a cycle, and a check that
  -- only walked the visible subgraph would let one be created by anyone with a private board.
  IF NEW.relation_type IN ('blocks', 'precedes', 'duplicates') THEN
    IF EXISTS (
      WITH RECURSIVE reachable(task_id) AS (
        SELECT NEW.target_task_id
        UNION
        SELECT r.target_task_id
        FROM public.task_relations r
        JOIN reachable ON r.source_task_id = reachable.task_id
        WHERE r.relation_type = NEW.relation_type
          AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
      )
      SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
    ) THEN
      RAISE EXCEPTION
        'That would create a circular "%" relationship. Work items cannot % each other in a loop.',
        NEW.relation_type, NEW.relation_type
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- The same pair cannot hold a relation and its own inverse: "A blocks B" plus "B blocks A"
  -- is the two-item case of the cycle above and is caught by it, but "A duplicates B" while
  -- "B duplicates A" deserves the clearer message.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_relation_integrity ON public.task_relations;
CREATE TRIGGER enforce_task_relation_integrity
  BEFORE INSERT OR UPDATE ON public.task_relations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_task_relation_integrity();

-- ---------------------------------------------------------------------------------------
-- Grants and RLS
--
-- A relation names TWO tasks, which makes its visibility rule different from every other
-- child table in this schema. SELECT requires can_view_task on BOTH ends: if the rule only
-- checked one, a user could learn that a task they cannot see exists, and read its id, merely
-- because something they can see points at it. That is the "hidden vs does not exist" trap
-- from CLAUDE.md, arriving through a join instead of a filter.
--
-- INSERT requires can_manage_task on the SOURCE and can_view_task on the TARGET. The source is
-- where the claim is being made from, so that is where authority is required; the target only
-- has to be something the author can legitimately see, or relations become a way to probe for
-- ids. Guests and clients are refused automatically, because can_manage_task already excludes
-- them via task_restricted_by_board_role - nothing here has to know about board roles.
--
-- DELETE requires can_manage_task on EITHER end, deliberately wider than INSERT: being wrongly
-- marked as blocking someone else's work is a claim about your item too, and the person who
-- can fix your item should be able to withdraw it.
--
-- There is no UPDATE policy. A relation has no editable content - changing either end or the
-- type makes it a different relation - so the only honest operations are create and delete.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.task_relations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.task_relations FROM anon;
REVOKE ALL ON public.task_relations FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_relations TO authenticated;

DROP POLICY IF EXISTS "Collaborators can view task relations" ON public.task_relations;
CREATE POLICY "Collaborators can view task relations"
  ON public.task_relations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.source_task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.target_task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can create task relations" ON public.task_relations;
CREATE POLICY "Collaborators can create task relations"
  ON public.task_relations FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.target_task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can remove task relations" ON public.task_relations;
CREATE POLICY "Collaborators can remove task relations"
  ON public.task_relations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_relations.target_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- ---------------------------------------------------------------------------------------
-- Both directions, one row. See the header for why security_invoker is not optional.
-- ---------------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.task_relations_expanded;
CREATE VIEW public.task_relations_expanded
WITH (security_invoker = true) AS
  SELECT
    r.id,
    r.source_task_id AS task_id,
    r.target_task_id AS related_task_id,
    r.relation_type  AS relation,
    FALSE            AS is_inverse,
    r.created_by,
    r.created_at
  FROM public.task_relations r
UNION ALL
  SELECT
    r.id,
    r.target_task_id AS task_id,
    r.source_task_id AS related_task_id,
    CASE r.relation_type
      WHEN 'blocks'     THEN 'blocked_by'
      WHEN 'precedes'   THEN 'follows'
      WHEN 'duplicates' THEN 'duplicated_by'
      ELSE 'relates_to'
    END              AS relation,
    TRUE             AS is_inverse,
    r.created_by,
    r.created_at
  FROM public.task_relations r;

COMMENT ON VIEW public.task_relations_expanded IS
  'Every relation seen from both ends. `relation` is the wording from task_id''s point of view, '
  'so blocks/blocked_by, precedes/follows and duplicates/duplicated_by both appear. is_inverse '
  'says which side of the stored row this is. security_invoker: RLS applies to the caller.';

REVOKE ALL ON public.task_relations_expanded FROM anon;
GRANT SELECT ON public.task_relations_expanded TO authenticated;

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks    BIGINT;
  v_before_policies BIGINT;
  v_after           BIGINT;
  v_count           BIGINT;
  v_opts            TEXT[];
BEGIN
  SELECT task_rows, policy_rows INTO v_before_tasks, v_before_policies FROM _115_precheck;

  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed during an additive migration (% -> %). Aborting.',
      v_before_tasks, v_after;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies + 3 THEN
    RAISE EXCEPTION 'Expected % policies after adding 3, found %. An existing policy was touched. Aborting.',
      v_before_policies + 3, v_count;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.task_relations'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on task_relations. Aborting.';
  END IF;

  -- The whole security story of the view rests on this one option.
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.task_relations_expanded'::regclass;
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY (v_opts)) THEN
    RAISE EXCEPTION
      'task_relations_expanded is not security_invoker - it would bypass RLS and expose every '
      'relation to every signed-in user. Aborting.';
  END IF;

  -- authenticated must not hold UPDATE: there is deliberately no UPDATE policy, and a grant
  -- without a policy is a silent zero-row write rather than a refusal.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'task_relations'
      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated holds UPDATE on task_relations but no UPDATE policy exists. Aborting.';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('task_relations') AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on task_relations. Aborting.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_task_relation_integrity'
      AND tgrelid = 'public.task_relations'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The relation integrity trigger is missing - cycles could be stored. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM public.task_relations;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 seeded relations, found %. Aborting.', v_count;
  END IF;

  RAISE NOTICE '115 verified: relations table + security_invoker view, % tasks untouched.', v_after;
END $$;

COMMIT;
