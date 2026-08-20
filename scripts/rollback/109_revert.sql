-- Rollback for 109_restrict_share_links_by_board_role.sql.
--
-- Restores the share_links INSERT policy verbatim as 074 defined it. Nothing between 074 and
-- 109 recreated that policy (075/080-083/095/100 mention the table but never this policy), so
-- 074's text is exactly the pre-109 state.
--
-- ⚠️ Reverting RE-OPENS the hole 109 closed: a board member narrowed to guest or client -
-- including a platform admin, and including the person who created the task - can once again
-- insert a share_links row directly through PostgREST and expose that work to the
-- unauthenticated public web. The Share button stays hidden either way, because
-- lib/capabilities.ts refuses `share.external` for those roles; that is a UX layer and not a
-- boundary, which is the whole reason 109 exists.
--
-- ── Safe to revert on its own ────────────────────────────────────────────────────────
-- Unlike 102's revert, this one does NOT have to be sequenced with a client change. No screen
-- calls a function 109 added (it added none), and no screen depends on the insert being
-- refused - a guest simply never sees the control. So reverting leaves a working app with a
-- weaker server-side rule, rather than a broken one.
--
-- No rows are read or written, so nothing here can destroy data. Existing share links are
-- untouched by both 109 and this revert; 109 only ever governed new inserts.
--
-- This is not a numbered migration and the runner will not pick it up (migrate.mjs reads
-- scripts/ non-recursively and matches /^\d{3,}.*\.sql$/). Apply it deliberately, the same way
-- 109 was applied. The ledger row is removed at the end so migrate:status matches reality.

BEGIN;

CREATE TEMP TABLE _109_revert_precheck ON COMMIT DROP AS
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

-- Post-conditions, inside the transaction, so a partial revert rolls back rather than leaving
-- share_links with no INSERT policy at all - which would silently make every share link
-- impossible to create rather than merely less restricted.
DO $$
DECLARE
  v_before_rows         bigint;
  v_after_rows          bigint;
  v_insert_policy_count integer;
  v_check               text;
BEGIN
  SELECT share_link_rows INTO v_before_rows FROM _109_revert_precheck;
  SELECT count(*) INTO v_after_rows FROM public.share_links;
  IF v_after_rows IS DISTINCT FROM v_before_rows THEN
    RAISE EXCEPTION 'share_links row count changed during a policy-only revert (% -> %). Aborting.',
      v_before_rows, v_after_rows;
  END IF;

  -- RLS policies are permissive and OR together, so a leftover copy of 109's policy would be
  -- indistinguishable from a successful revert until someone tested a guest.
  SELECT count(*)
  INTO v_insert_policy_count
  FROM pg_policy
  WHERE polrelid = 'public.share_links'::regclass
    AND polcmd = 'a';

  IF v_insert_policy_count <> 1 THEN
    RAISE EXCEPTION 'share_links must have exactly one INSERT policy after the revert; found %. Aborting.',
      v_insert_policy_count;
  END IF;

  SELECT pg_get_expr(polwithcheck, polrelid)
  INTO v_check
  FROM pg_policy
  WHERE polrelid = 'public.share_links'::regclass
    AND polname = 'Create authorized share links'
    AND polcmd = 'a'
    AND 'authenticated'::regrole = ANY(polroles);

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'share_links INSERT policy is missing after the revert. Aborting.';
  END IF;

  -- The inverse of 109's own assertion: the board-role boundary must be GONE, or this file
  -- reported success while changing nothing.
  IF position('board_members' IN v_check) > 0 THEN
    RAISE EXCEPTION 'share_links INSERT policy still carries the guest/client board-role boundary; 109 was not reverted. Aborting.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.share_links'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on share_links. Aborting.';
  END IF;

  RAISE NOTICE '109 reverted: share-link INSERT is back to the 074 rule and no longer checks board role; % existing links untouched.',
    v_after_rows;
END $$;

DELETE FROM public.applied_migrations WHERE filename LIKE '109%';

COMMIT;
