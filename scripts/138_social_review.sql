-- 138: social post approvals. The `social_media` module, a Social media page where the
-- marketing team (admins and calendar members, the same set as the marketing calendar)
-- reviews Facebook and TikTok posts before they go out.
--
-- social_posts holds the post; social_post_reviews is the history of decisions and notes.
-- A post's status follows its latest decision through a trigger, so the two cannot disagree.
-- Asking for changes or rejecting needs a written note, enforced here and not only in the UI.
--
-- ⚠️ Owner decision (2026-11-17): the module seeds ON so the tab appears on deploy. Every
-- other module since 080 seeds off; this one was asked for by name. Not precedent.
--
-- Purely additive: two new tables, one trigger on a new table, one bucket, one module row.
-- Rollback: scripts/rollback/138_revert.sql

BEGIN;

DROP TABLE IF EXISTS _138_precheck;
CREATE TEMP TABLE _138_precheck AS
SELECT (SELECT count(*) FROM public.app_modules) AS module_rows;

CREATE TABLE IF NOT EXISTS public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable key from wherever the post was drafted, so a re-upload updates instead of duplicating.
  external_ref TEXT UNIQUE,
  brand TEXT NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 120),
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'tiktok', 'instagram')),
  format TEXT NOT NULL CHECK (format IN ('post', 'reel', 'carousel', 'story')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 5000),
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  scheduled_for TIMESTAMP WITH TIME ZONE,
  -- [{ "path": "<storage path>", "kind": "image" | "video", "poster": "<storage path>" }]
  media JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(media) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'changes_requested', 'rejected', 'posted')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_schedule ON public.social_posts (scheduled_for);

CREATE TABLE IF NOT EXISTS public.social_post_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected', 'comment')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- \S, not btrim: a note of only tabs or newlines is still blank (see 133).
  CONSTRAINT social_review_note_required CHECK (decision = 'approved' OR (note IS NOT NULL AND note ~ '\S'))
);

CREATE INDEX IF NOT EXISTS idx_social_post_reviews_post ON public.social_post_reviews (post_id, created_at);

-- The latest decision sets the post's status. Comments leave it alone.
CREATE OR REPLACE FUNCTION private.social_post_follow_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.decision <> 'comment' THEN
    UPDATE public.social_posts SET status = NEW.decision, updated_at = NOW() WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.social_post_follow_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS social_post_follow_review ON public.social_post_reviews;
CREATE TRIGGER social_post_follow_review
  AFTER INSERT ON public.social_post_reviews
  FOR EACH ROW EXECUTE FUNCTION private.social_post_follow_review();

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.social_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.social_post_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
-- Reviews are a history: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON public.social_post_reviews TO authenticated;

DROP POLICY IF EXISTS "Marketing team reads social posts" ON public.social_posts;
CREATE POLICY "Marketing team reads social posts" ON public.social_posts FOR SELECT
  TO authenticated USING (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team adds social posts" ON public.social_posts;
CREATE POLICY "Marketing team adds social posts" ON public.social_posts FOR INSERT
  TO authenticated WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team edits social posts" ON public.social_posts;
CREATE POLICY "Marketing team edits social posts" ON public.social_posts FOR UPDATE
  TO authenticated USING (private.can_manage_marketing_channels()) WITH CHECK (private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team removes social posts" ON public.social_posts;
CREATE POLICY "Marketing team removes social posts" ON public.social_posts FOR DELETE
  TO authenticated USING (private.can_manage_marketing_channels());

DROP POLICY IF EXISTS "Marketing team reads reviews" ON public.social_post_reviews;
CREATE POLICY "Marketing team reads reviews" ON public.social_post_reviews FOR SELECT
  TO authenticated USING (private.can_manage_marketing_channels());
-- A review is always in your own name.
DROP POLICY IF EXISTS "Marketing team reviews as themselves" ON public.social_post_reviews;
CREATE POLICY "Marketing team reviews as themselves" ON public.social_post_reviews FOR INSERT
  TO authenticated WITH CHECK (reviewer_id = (SELECT auth.uid()) AND private.can_manage_marketing_channels());

-- Private bucket at the Free plan's 50 MB ceiling (see 093). Paths start with the post id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-media', 'social-media', FALSE, 52428800, ARRAY['image/jpeg', 'image/png', 'video/mp4'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Marketing team reads social media files" ON storage.objects;
CREATE POLICY "Marketing team reads social media files" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'social-media' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team uploads social media files" ON storage.objects;
CREATE POLICY "Marketing team uploads social media files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'social-media' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team replaces social media files" ON storage.objects;
CREATE POLICY "Marketing team replaces social media files" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'social-media' AND private.can_manage_marketing_channels());
DROP POLICY IF EXISTS "Marketing team removes social media files" ON storage.objects;
CREATE POLICY "Marketing team removes social media files" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'social-media' AND private.can_manage_marketing_channels());

INSERT INTO public.app_modules (module_key, enabled)
VALUES ('social_media', true)
ON CONFLICT (module_key) DO NOTHING;

DO $post$
DECLARE
  v_before BIGINT;
  v_count  BIGINT;
BEGIN
  SELECT module_rows INTO v_before FROM _138_precheck;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'social_posts';
  IF v_count <> 4 THEN RAISE EXCEPTION '138: expected 4 policies on social_posts, found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'social_post_reviews';
  IF v_count <> 2 THEN RAISE EXCEPTION '138: expected 2 policies on social_post_reviews, found %', v_count; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_posts'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_post_reviews'::regclass) THEN
    RAISE EXCEPTION '138: RLS must be on for both tables';
  END IF;

  IF has_table_privilege('anon', 'public.social_posts', 'SELECT')
     OR has_table_privilege('anon', 'public.social_post_reviews', 'SELECT') THEN
    RAISE EXCEPTION '138: anon must hold nothing';
  END IF;
  IF has_table_privilege('authenticated', 'public.social_post_reviews', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.social_post_reviews', 'DELETE') THEN
    RAISE EXCEPTION '138: reviews are history, no UPDATE or DELETE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'social-media' AND public = false) THEN
    RAISE EXCEPTION '138: the social-media bucket must exist and be private';
  END IF;

  SELECT count(*) INTO v_count FROM public.app_modules;
  IF v_count IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION '138: expected one new module row, went % -> %', v_before, v_count;
  END IF;

  -- The note rule, tried for real and rolled back.
  BEGIN
    INSERT INTO public.social_posts (id, brand, platform, format, title) VALUES
      ('00000000-0000-0000-0000-000000000138', '_138_probe', 'facebook', 'post', '_138_probe');
    BEGIN
      INSERT INTO public.social_post_reviews (post_id, decision, note)
      VALUES ('00000000-0000-0000-0000-000000000138', 'rejected', E'\t\n');
      RAISE EXCEPTION '138: a blank rejection note was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO public.social_post_reviews (post_id, decision, note)
    VALUES ('00000000-0000-0000-0000-000000000138', 'changes_requested', 'Shorter caption');
    IF (SELECT status FROM public.social_posts WHERE id = '00000000-0000-0000-0000-000000000138') <> 'changes_requested' THEN
      RAISE EXCEPTION '138: status did not follow the review';
    END IF;
    INSERT INTO public.social_post_reviews (post_id, decision, note)
    VALUES ('00000000-0000-0000-0000-000000000138', 'comment', 'Looks good otherwise');
    IF (SELECT status FROM public.social_posts WHERE id = '00000000-0000-0000-0000-000000000138') <> 'changes_requested' THEN
      RAISE EXCEPTION '138: a comment changed the status';
    END IF;
    DELETE FROM public.social_posts WHERE id = '00000000-0000-0000-0000-000000000138';
  END;

  RAISE NOTICE '138 verified: social_posts + reviews ready, status follows reviews, notes enforced, bucket private.';
END
$post$;

COMMIT;
