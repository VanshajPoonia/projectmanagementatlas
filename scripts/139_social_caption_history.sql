-- 139: the marketing team can edit a social post's description (caption and hashtags) on the
-- Social media page, and every earlier wording is kept so it can be compared and restored.
--
-- social_post_caption_versions is the history, and authenticated may only read it. The way in
-- is edit_social_post_caption(), which writes the new wording and its version row in one
-- transaction, so the page cannot save an edit that skips the history or forge one in it.
--
-- There is deliberately no trigger on social_posts. Shanks Social's upload_portal.mjs writes
-- captions straight to the table, and a wording it put there is captured as an 'uploaded'
-- version the first time anyone edits after it. That keeps this migration purely additive.
--
-- Saving needs the wording the editor started from. If the post changed in between (a re-upload,
-- or someone else saving), the save is refused rather than overwriting what it never saw.
-- An edit does not move updated_at, so the editor's own change never shows as "Updated for you".
--
-- Purely additive: one new table, two new functions. Eligible on this repo's rule.
-- Rollback: scripts/rollback/139_revert.sql

BEGIN;

DROP TABLE IF EXISTS _139_precheck;
CREATE TEMP TABLE _139_precheck AS
SELECT
  (SELECT count(*) FROM public.social_posts) AS post_rows,
  (SELECT count(*) FROM public.social_post_reviews) AS review_rows;

CREATE TABLE IF NOT EXISTS public.social_post_caption_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  caption TEXT NOT NULL CHECK (char_length(caption) <= 5000),
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  -- uploaded: the wording a save replaced, when history did not hold it yet.
  -- edited / restored: saved on the Social media page by edited_by.
  source TEXT NOT NULL CHECK (source IN ('uploaded', 'edited', 'restored')),
  restored_from UUID REFERENCES public.social_post_caption_versions(id) ON DELETE SET NULL,
  -- SET NULL, not CASCADE: removing a person keeps the wording and drops the name (see 128).
  edited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- clock_timestamp, not NOW: one save writes two rows and they must sort in the order written.
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_social_caption_versions_post
  ON public.social_post_caption_versions (post_id, created_at);

ALTER TABLE public.social_post_caption_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.social_post_caption_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.social_post_caption_versions TO authenticated;

DROP POLICY IF EXISTS "Marketing team reads caption history" ON public.social_post_caption_versions;
CREATE POLICY "Marketing team reads caption history" ON public.social_post_caption_versions FOR SELECT
  TO authenticated USING (private.can_manage_marketing_channels());

-- The save itself, with no permission check, so the post-conditions below can drive it.
CREATE OR REPLACE FUNCTION private.save_social_caption(
  p_post_id UUID,
  p_caption TEXT,
  p_hashtags TEXT[],
  p_expected_caption TEXT,
  p_expected_hashtags TEXT[],
  p_editor UUID,
  p_restored_from UUID
)
RETURNS SETOF public.social_post_caption_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.social_posts%ROWTYPE;
  v_last public.social_post_caption_versions%ROWTYPE;
  v_tags TEXT[] := COALESCE(p_hashtags, '{}');
BEGIN
  -- \S, not btrim: a caption of only tabs or newlines is still blank (see 133).
  IF p_caption IS NULL OR p_caption !~ '\S' THEN
    RAISE EXCEPTION 'The description cannot be blank.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_post FROM public.social_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_post.caption IS DISTINCT FROM p_expected_caption
     OR v_post.hashtags IS DISTINCT FROM COALESCE(p_expected_hashtags, '{}') THEN
    RAISE EXCEPTION 'This description changed since you opened it. Reload the page to see the latest wording.'
      USING ERRCODE = 'P0001', HINT = 'stale';
  END IF;

  IF p_restored_from IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.social_post_caption_versions WHERE id = p_restored_from AND post_id = p_post_id
  ) THEN
    RAISE EXCEPTION 'That version belongs to another post.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_post.caption = p_caption AND v_post.hashtags = v_tags THEN
    RETURN;
  END IF;

  -- Keep the wording being replaced, unless it is already the latest version on record.
  SELECT * INTO v_last FROM public.social_post_caption_versions
  WHERE post_id = p_post_id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT FOUND OR v_last.caption IS DISTINCT FROM v_post.caption OR v_last.hashtags IS DISTINCT FROM v_post.hashtags THEN
    RETURN QUERY
      INSERT INTO public.social_post_caption_versions (post_id, caption, hashtags, source)
      VALUES (p_post_id, v_post.caption, v_post.hashtags, 'uploaded')
      RETURNING *;
  END IF;

  UPDATE public.social_posts SET caption = p_caption, hashtags = v_tags WHERE id = p_post_id;

  RETURN QUERY
    INSERT INTO public.social_post_caption_versions (post_id, caption, hashtags, source, restored_from, edited_by)
    VALUES (p_post_id, p_caption, v_tags, CASE WHEN p_restored_from IS NULL THEN 'edited' ELSE 'restored' END,
            p_restored_from, p_editor)
    RETURNING *;
END $$;

REVOKE ALL ON FUNCTION private.save_social_caption(UUID, TEXT, TEXT[], TEXT, TEXT[], UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- What the page calls. Same people as 138's policies: admins and marketing calendar members.
CREATE OR REPLACE FUNCTION public.edit_social_post_caption(
  p_post_id UUID,
  p_caption TEXT,
  p_hashtags TEXT[],
  p_expected_caption TEXT,
  p_expected_hashtags TEXT[],
  p_restored_from UUID DEFAULT NULL
)
RETURNS SETOF public.social_post_caption_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.can_manage_marketing_channels() THEN
    RAISE EXCEPTION 'Only the marketing team can edit social posts.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT * FROM private.save_social_caption(
    p_post_id, p_caption, p_hashtags, p_expected_caption, p_expected_hashtags, (SELECT auth.uid()), p_restored_from
  );
END $$;

REVOKE ALL ON FUNCTION public.edit_social_post_caption(UUID, TEXT, TEXT[], TEXT, TEXT[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_social_post_caption(UUID, TEXT, TEXT[], TEXT, TEXT[], UUID) TO authenticated;

DO $post$
DECLARE
  v_pre   RECORD;
  v_count BIGINT;
  v_first UUID;
  v_row   public.social_post_caption_versions%ROWTYPE;
  v_trail TEXT;
  v_probe CONSTANT UUID := '00000000-0000-0000-0000-000000000139';
BEGIN
  SELECT * INTO v_pre FROM _139_precheck;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_post_caption_versions'::regclass) THEN
    RAISE EXCEPTION '139: RLS must be on for social_post_caption_versions';
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'social_post_caption_versions';
  IF v_count <> 1 THEN RAISE EXCEPTION '139: expected 1 policy on social_post_caption_versions, found %', v_count; END IF;

  IF has_table_privilege('anon', 'public.social_post_caption_versions', 'SELECT') THEN
    RAISE EXCEPTION '139: anon must hold nothing on the history';
  END IF;
  IF has_table_privilege('authenticated', 'public.social_post_caption_versions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.social_post_caption_versions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.social_post_caption_versions', 'DELETE') THEN
    RAISE EXCEPTION '139: the history is read-only to the app, writes go through edit_social_post_caption';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.edit_social_post_caption(uuid, text, text[], text, text[], uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.edit_social_post_caption(uuid, text, text[], text, text[], uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.save_social_caption(uuid, text, text[], text, text[], uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '139: only authenticated may call the edit, and nobody may call the unchecked save';
  END IF;

  -- The save, tried for real and rolled back with the probe post.
  INSERT INTO public.social_posts (id, brand, platform, format, title, caption, hashtags)
  VALUES (v_probe, '_139_probe', 'facebook', 'post', '_139_probe', 'First', '{one}');

  SELECT count(*) INTO v_count FROM private.save_social_caption(v_probe, 'Second', '{two}', 'First', '{one}', NULL, NULL);
  IF v_count <> 2 THEN RAISE EXCEPTION '139: a first edit should keep the uploaded wording and the new one, got % rows', v_count; END IF;
  IF (SELECT caption FROM public.social_posts WHERE id = v_probe) <> 'Second' THEN
    RAISE EXCEPTION '139: the edit did not reach the post';
  END IF;

  BEGIN
    PERFORM private.save_social_caption(v_probe, 'Stale', '{}', 'First', '{one}', NULL, NULL);
    RAISE EXCEPTION '139: a save from a stale wording was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'This description changed%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM private.save_social_caption(v_probe, E'\t\n', '{}', 'Second', '{two}', NULL, NULL);
    RAISE EXCEPTION '139: a blank description was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT count(*) INTO v_count FROM private.save_social_caption(v_probe, 'Second', '{two}', 'Second', '{two}', NULL, NULL);
  IF v_count <> 0 THEN RAISE EXCEPTION '139: saving the same wording wrote % rows', v_count; END IF;

  -- A re-upload changes the caption outside the editor. The next edit has to keep that wording too.
  UPDATE public.social_posts SET caption = 'Third' WHERE id = v_probe;
  SELECT count(*) INTO v_count FROM private.save_social_caption(v_probe, 'Fourth', '{two}', 'Third', '{two}', NULL, NULL);
  IF v_count <> 2 THEN RAISE EXCEPTION '139: a wording changed outside the editor was not kept, got % rows', v_count; END IF;

  SELECT id INTO v_first FROM public.social_post_caption_versions WHERE post_id = v_probe ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_row FROM private.save_social_caption(v_probe, 'First', '{one}', 'Fourth', '{two}', NULL, v_first);
  IF v_row.source <> 'restored' OR v_row.restored_from <> v_first
     OR (SELECT caption FROM public.social_posts WHERE id = v_probe) <> 'First' THEN
    RAISE EXCEPTION '139: restoring the first version did not bring it back';
  END IF;

  SELECT string_agg(source || ':' || caption, ' ' ORDER BY created_at, id) INTO v_trail
  FROM public.social_post_caption_versions WHERE post_id = v_probe;
  IF v_trail IS DISTINCT FROM 'uploaded:First edited:Second uploaded:Third edited:Fourth restored:First' THEN
    RAISE EXCEPTION '139: history came out as %', v_trail;
  END IF;

  DELETE FROM public.social_posts WHERE id = v_probe;
  IF EXISTS (SELECT 1 FROM public.social_post_caption_versions WHERE post_id = v_probe) THEN
    RAISE EXCEPTION '139: deleting a post left its history behind';
  END IF;

  IF (SELECT count(*) FROM public.social_posts) <> v_pre.post_rows
     OR (SELECT count(*) FROM public.social_post_reviews) <> v_pre.review_rows THEN
    RAISE EXCEPTION '139: existing posts or reviews changed';
  END IF;

  RAISE NOTICE '139 verified: caption history read-only, edits keep the wording they replace, stale saves refused, restore works.';
END
$post$;

DROP TABLE IF EXISTS _139_precheck;

COMMIT;
