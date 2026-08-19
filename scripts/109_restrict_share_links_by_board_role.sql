-- 109: a view-only board role must not be able to expand the audience to the public web.
--
-- Migration 065 made explicit board_members rows with role guest/client read-only, including
-- when the person is a task creator or a platform admin. Migration 074's share_links INSERT
-- policy predates that rule: it checks creator/admin ownership and board privacy, but not the
-- caller's board role. A task creator demoted to guest can therefore bypass the hidden Share
-- button and insert a public link directly through PostgREST.
--
-- Absence of a board_members row remains the full-access default for this single-org product,
-- and role='member' remains unchanged. The new predicate only narrows an explicit guest/client
-- row. It is present in BOTH resource branches so task and board links cannot drift apart.

BEGIN;

CREATE TEMP TABLE _109_precheck ON COMMIT DROP AS
SELECT count(*) AS share_link_rows FROM public.share_links;

DROP POLICY IF EXISTS "Create authorized share links" ON public.share_links;
CREATE POLICY "Create authorized share links"
  ON public.share_links FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      (
        resource_type = 'board'
        AND EXISTS (
          SELECT 1
          FROM public.boards b
          WHERE b.id = resource_id
            AND b.archived_at IS NULL
            -- The primary key on (board_id, user_id) makes this an indexed, at-most-one-row
            -- lookup. board_members' SELECT policy exposes a caller's own row, which is the
            -- only row inspected here.
            AND NOT EXISTS (
              SELECT 1
              FROM public.board_members bm
              WHERE bm.board_id = b.id
                AND bm.user_id = (SELECT auth.uid())
                AND bm.role IN ('guest', 'client')
            )
            AND (
              b.created_by = (SELECT auth.uid())
              OR private.is_admin_user()
            )
            AND (
              NOT b.is_private
              OR b.created_by = (SELECT auth.uid())
              OR public.is_board_member(b.id, (SELECT auth.uid()))
            )
        )
      )
      OR
      (
        resource_type = 'task'
        AND EXISTS (
          SELECT 1
          FROM public.tasks t
          JOIN public.columns c ON c.id = t.column_id
          JOIN public.boards b ON b.id = c.board_id
          WHERE t.id = resource_id
            AND t.deleted_at IS NULL
            AND t.archived_at IS NULL
            AND b.archived_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.board_members bm
              WHERE bm.board_id = b.id
                AND bm.user_id = (SELECT auth.uid())
                AND bm.role IN ('guest', 'client')
            )
            AND (
              t.created_by = (SELECT auth.uid())
              OR private.is_admin_user()
            )
            AND (
              NOT b.is_private
              OR b.created_by = (SELECT auth.uid())
              OR public.is_board_member(b.id, (SELECT auth.uid()))
            )
        )
      )
    )
  );

-- Fail closed if the replacement did not produce the one INSERT boundary this table expects.
-- RLS policies are permissive by default, so a stray second INSERT policy would OR with this one
-- and could silently restore the bypass.
DO $$
DECLARE
  v_before_rows         bigint;
  v_after_rows          bigint;
  v_insert_policy_count integer;
  v_check               text;
BEGIN
  SELECT share_link_rows INTO v_before_rows FROM _109_precheck;
  SELECT count(*) INTO v_after_rows FROM public.share_links;
  IF v_after_rows IS DISTINCT FROM v_before_rows THEN
    RAISE EXCEPTION 'share_links row count changed during a policy-only migration (% -> %). Aborting.',
      v_before_rows, v_after_rows;
  END IF;

  SELECT count(*)
  INTO v_insert_policy_count
  FROM pg_policy
  WHERE polrelid = 'public.share_links'::regclass
    AND polcmd = 'a';

  IF v_insert_policy_count <> 1 THEN
    RAISE EXCEPTION 'share_links must have exactly one INSERT policy; found %. Aborting.',
      v_insert_policy_count;
  END IF;

  SELECT pg_get_expr(polwithcheck, polrelid)
  INTO v_check
  FROM pg_policy
  WHERE polrelid = 'public.share_links'::regclass
    AND polname = 'Create authorized share links'
    AND polcmd = 'a'
    AND 'authenticated'::regrole = ANY(polroles);

  IF v_check IS NULL
     OR position('board_members' IN v_check) = 0
     OR position('guest' IN v_check) = 0
     OR position('client' IN v_check) = 0 THEN
    RAISE EXCEPTION 'share_links INSERT policy is missing the guest/client board-role boundary. Aborting.';
  END IF;

  RAISE NOTICE '109 verified: share-link INSERT now respects guest/client roles; % existing links untouched.',
    v_after_rows;
END $$;

COMMIT;
