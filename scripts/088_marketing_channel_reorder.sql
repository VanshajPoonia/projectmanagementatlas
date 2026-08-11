-- Lets the marketing calendar's channel columns be rearranged, and persists that
-- order for everyone (the channel list is shared, so the column order is a fact
-- about the calendar, not about the viewer — same reasoning as 087's shared checks).
--
-- Why an RPC instead of widening the UPDATE policy: marketing_channels' UPDATE is
-- gated on `profiles.role = 'admin'` LITERALLY (054, narrowed by 055), which excludes
-- super_admin — so Bobby and Kayla, the two people who actually use this calendar,
-- would have silently failed every reorder write. Widening that policy to all
-- authenticated users would also hand out renaming: marketing_calendar_items.channel
-- stores the channel as TEXT with no FK, so renaming a channel orphans every event
-- pointing at the old string. This function is the narrow middle: it can only
-- renumber `position`, never rename, archive, or delete. Renaming/deleting stays
-- admin-only exactly as 055 left it.
--
-- The caller must send every active channel exactly once. A stale client (one that
-- has not seen a channel someone else just added) is rejected with an error it can
-- recover from by reloading, rather than silently renumbering a partial list.
--
-- SECURITY DEFINER because the function's whole job is to bypass that admin-only
-- UPDATE policy for this one column; `SET search_path = ''` and the auth.uid() gate
-- are what keep that safe. A freshly created function grants EXECUTE to PUBLIC by
-- default, so the REVOKE below is mandatory, not hardening (see 084's note).

BEGIN;

CREATE OR REPLACE FUNCTION public.reorder_marketing_channels(p_channel_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_given    INTEGER;
  v_matched  INTEGER;
  v_active   INTEGER;
  v_updated  INTEGER;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  v_given := COALESCE(array_length(p_channel_ids, 1), 0);
  IF v_given = 0 THEN
    RAISE EXCEPTION 'A channel ordering is required';
  END IF;

  IF array_position(p_channel_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Channel ordering contains a NULL id';
  END IF;

  -- DISTINCT so a duplicated id fails the equality below instead of quietly
  -- winning the last position it appears in.
  SELECT count(DISTINCT id) INTO v_matched
  FROM public.marketing_channels
  WHERE id = ANY(p_channel_ids) AND NOT is_archived;

  SELECT count(*) INTO v_active
  FROM public.marketing_channels
  WHERE NOT is_archived;

  IF v_matched <> v_given OR v_given <> v_active THEN
    RAISE EXCEPTION
      'Channel ordering is stale: expected all % active channels exactly once, got %',
      v_active, v_given;
  END IF;

  UPDATE public.marketing_channels mc
  SET position = ord.sort_index - 1
  FROM unnest(p_channel_ids) WITH ORDINALITY AS ord(channel_id, sort_index)
  WHERE mc.id = ord.channel_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.reorder_marketing_channels(UUID[]) IS
  'Renumbers marketing_channels.position to match the given id order. The only write '
  'path to channel ordering for non-admins; cannot rename, archive, or delete.';

REVOKE ALL ON FUNCTION public.reorder_marketing_channels(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_marketing_channels(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_marketing_channels(UUID[]) TO authenticated;

-- Post-conditions: roll back rather than half-apply (see CLAUDE.md conventions).
DO $post$
DECLARE
  v_secdef  BOOLEAN;
  v_search  TEXT[];
  v_policies INTEGER;
  v_rls     BOOLEAN;
BEGIN
  SELECT p.prosecdef, p.proconfig
  INTO v_secdef, v_search
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reorder_marketing_channels';

  IF v_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'post-condition: reorder_marketing_channels must be SECURITY DEFINER';
  END IF;

  -- Postgres stores the empty search_path quoted ('search_path=""'); accept the
  -- bare form too rather than depending on how a given server spells it.
  IF v_search IS NULL OR NOT (v_search && ARRAY['search_path=""', 'search_path=']) THEN
    RAISE EXCEPTION 'post-condition: reorder_marketing_channels must pin an empty search_path, got %', v_search;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.reorder_marketing_channels(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition: authenticated must be able to execute the reorder function';
  END IF;

  -- anon inherits anything granted to PUBLIC, so this also catches the default
  -- PUBLIC grant that CREATE FUNCTION hands out.
  IF has_function_privilege('anon', 'public.reorder_marketing_channels(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition: anon must not be able to execute the reorder function';
  END IF;

  -- This migration must not touch the table's own protection. Renaming/archiving
  -- a channel stays admin-only; ordering is the only thing that opened up.
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.marketing_channels'::regclass;
  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'post-condition: RLS must still be enabled on marketing_channels';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies WHERE tablename = 'marketing_channels';
  IF v_policies <> 4 THEN
    RAISE EXCEPTION 'post-condition: expected marketing_channels to still have its 4 policies, found %', v_policies;
  END IF;
END
$post$;

COMMIT;
